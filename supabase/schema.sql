-- Flussreich: Supabase-Schema
-- Angewendet auf das Projekt "Flussreich" (ref qkcvqzzaxmoktaqsiujv) am 2026-11-06.
-- Die gleichen Schritte liegen einzeln in supabase/migrations/.
-- Änderungen gegenüber dem ursprünglichen Plan sind mit "FIX" markiert.

------------------------------------------------------------------------------
-- 1. Profile, Cloud-Saves, Tagesmarkt
------------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique check (char_length(username) between 3 and 20),
  created_at timestamptz not null default now()
);

-- FIX: Profil automatisch bei der Registrierung anlegen (auch bei anonymer Anmeldung).
-- Ohne Profil scheitert jedes Insert in saves/daily_results am Fremdschlüssel.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create table public.saves (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  slot smallint not null check (slot between 1 and 5),
  name text not null check (char_length(name) between 1 and 60),
  -- FIX: Größe begrenzen, damit niemand den Free-Tier-Speicher füllt (512 KB je Spielstand)
  data jsonb not null check (pg_column_size(data) <= 524288),
  updated_at timestamptz not null default now(),
  unique (user_id, slot)
);

create table public.daily_results (
  id bigint generated always as identity primary key,
  day date not null,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  wealth integer not null check (wealth >= 0),
  created_at timestamptz not null default now(),
  unique (day, user_id)
);

-- FIX: Bestenliste fragt nach Tag sortiert nach Vermögen
create index daily_results_day_wealth_idx on public.daily_results (day, wealth desc);

------------------------------------------------------------------------------
-- 2. Online-Handelsliga (serverseitig gerechnet, Client kann nicht schummeln)
------------------------------------------------------------------------------

create table public.league_market (
  town_id text not null,
  good_id text not null,
  base_price integer not null check (base_price > 0),
  stock integer not null check (stock >= 0),
  target_stock integer not null check (target_stock > 0),
  -- FIX: Ruhebestand wie im Einzelspiel, sonst hätten alle Städte dieselben Preise
  rest_stock integer not null check (rest_stock >= 0),
  updated_at timestamptz not null default now(),
  primary key (town_id, good_id)
);

create table public.league_players (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  gold integer not null default 300 check (gold >= 0),
  cargo jsonb not null default '{}'::jsonb,
  town_id text not null,
  arrives_at timestamptz not null default now(),
  wealth integer not null default 300,
  updated_at timestamptz not null default now()
);

create index league_players_wealth_idx on public.league_players (wealth desc);

create table public.league_trades (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  town_id text not null,
  good_id text not null,
  amount integer not null,
  taler integer not null,
  created_at timestamptz not null default now()
);

create index league_trades_user_idx on public.league_trades (user_id, created_at desc);

------------------------------------------------------------------------------
-- 3. Zeilensicherheit
------------------------------------------------------------------------------

alter table public.profiles       enable row level security;
alter table public.saves          enable row level security;
alter table public.daily_results  enable row level security;
alter table public.league_market  enable row level security;
alter table public.league_players enable row level security;
alter table public.league_trades  enable row level security;

create policy "profile lesbar" on public.profiles for select using (true);
create policy "eigenes profil aendern" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "eigene saves" on public.saves for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "daily lesbar" on public.daily_results for select using (true);
create policy "eigenes daily eintragen" on public.daily_results for insert to authenticated
  with check (user_id = (select auth.uid()));
-- FIX: Ein Ergebnis pro Tag darf verbessert werden (upsert), aber nur das eigene
create policy "eigenes daily verbessern" on public.daily_results for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Markt und Liga nur lesbar, geschrieben wird über die Funktionen unten
create policy "markt lesbar" on public.league_market for select using (true);
create policy "liga lesbar" on public.league_players for select using (true);
create policy "eigene trades lesbar" on public.league_trades for select to authenticated
  using (user_id = (select auth.uid()));

------------------------------------------------------------------------------
-- 4. Liga-Funktionen
------------------------------------------------------------------------------

-- Gleiche Formel wie src/sim/economy.ts price()
create or replace function public.league_price(p_base integer, p_stock integer, p_target integer)
returns integer
language sql
immutable
set search_path = ''
as $$
  select greatest(1, round(p_base * least(3.0, greatest(0.3, p_target::numeric / greatest(1, p_stock)))))::integer;
$$;

-- Vermögen = Taler + Ladung zum Grundpreis
create or replace function public.league_wealth(p_gold integer, p_cargo jsonb)
returns integer
language sql
stable
set search_path = ''
as $$
  select p_gold + coalesce((
    select sum((c.value)::integer * g.base_price)::integer
      from jsonb_each_text(p_cargo) c
      join (select distinct on (good_id) good_id, base_price from public.league_market) g
        on g.good_id = c.key
  ), 0);
$$;

-- Liga beitreten: legt den Spieler in der ersten Stadt mit 300 Talern an
create or replace function public.league_join()
returns public.league_players
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.league_players;
begin
  if auth.uid() is null then
    raise exception 'nicht angemeldet';
  end if;

  insert into public.league_players (user_id, town_id)
  values (auth.uid(), (select min(town_id) from public.league_market))
  on conflict (user_id) do nothing;

  select * into v_row from public.league_players where user_id = auth.uid();
  return v_row;
end;
$$;

-- Reisen: Der Kahn ist 45 Sekunden unterwegs, solange kann nicht gehandelt werden
create or replace function public.league_travel(p_town text)
returns public.league_players
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.league_players;
begin
  if auth.uid() is null then
    raise exception 'nicht angemeldet';
  end if;
  if not exists (select 1 from public.league_market where town_id = p_town) then
    raise exception 'unbekannte stadt';
  end if;

  update public.league_players
     set town_id = p_town,
         arrives_at = case when town_id = p_town then arrives_at else now() + interval '45 seconds' end,
         updated_at = now()
   where user_id = auth.uid()
     and arrives_at <= now()
  returning * into v_row;

  if not found then
    if exists (select 1 from public.league_players where user_id = auth.uid()) then
      raise exception 'noch unterwegs';
    end if;
    raise exception 'nicht in der liga';
  end if;

  return v_row;
end;
$$;

-- Handel: positive Menge = an die Stadt verkaufen, negative = kaufen.
-- Preis, Taler, Ladung und Kapazität (40 t) werden hier geprüft.
-- Gibt den neuen Stand des Spielers samt Marktbestand und Talerbetrag zurück.
create or replace function public.league_trade(p_town text, p_good text, p_amount integer)
returns jsonb
language plpgsql
security definer
set search_path = ''  -- FIX: leerer Suchpfad, alle Namen voll qualifiziert
as $$
declare
  v_player public.league_players;
  v_market public.league_market;
  v_have integer;
  v_load integer;
  v_taler integer;
  v_n integer := abs(p_amount);
begin
  if auth.uid() is null then
    raise exception 'nicht angemeldet';
  end if;

  if p_amount is null or p_amount = 0 or v_n > 200 then
    raise exception 'ungueltige menge';
  end if;

  select * into v_player from public.league_players where user_id = auth.uid() for update;
  if not found then
    raise exception 'nicht in der liga';
  end if;
  if v_player.town_id <> p_town or v_player.arrives_at > now() then
    raise exception 'nicht in dieser stadt';
  end if;

  -- Zeile sperren, damit gleichzeitige Käufe den Bestand nicht doppelt verbrauchen
  select * into v_market from public.league_market
   where town_id = p_town and good_id = p_good
   for update;
  if not found then
    raise exception 'unbekannter markt';
  end if;

  v_have := coalesce((v_player.cargo ->> p_good)::integer, 0);
  select coalesce(sum(value::integer), 0) into v_load from jsonb_each_text(v_player.cargo);

  if p_amount < 0 then
    -- FIX: Kauf über den Bestand hinaus ablehnen statt still auf 0 zu kappen.
    if v_market.stock < v_n then
      raise exception 'nicht genug bestand';
    end if;
    if v_load + v_n > 40 then
      raise exception 'laderaum voll';
    end if;
    select sum(public.league_price(v_market.base_price, v_market.stock - i, v_market.target_stock))
      into v_taler from generate_series(1, v_n) i;
    if v_taler > v_player.gold then
      raise exception 'nicht genug taler';
    end if;
    v_player.gold := v_player.gold - v_taler;
    v_have := v_have + v_n;
  else
    if v_have < v_n then
      raise exception 'nicht genug ladung';
    end if;
    select sum(floor(public.league_price(v_market.base_price, v_market.stock + i, v_market.target_stock) * 0.9))
      into v_taler from generate_series(1, v_n) i;
    v_player.gold := v_player.gold + v_taler;
    v_have := v_have - v_n;
  end if;

  update public.league_market
     set stock = stock + p_amount,
         updated_at = now()
   where town_id = p_town and good_id = p_good
  returning stock into v_market.stock;

  v_player.cargo := case when v_have = 0 then v_player.cargo - p_good
                         else jsonb_set(v_player.cargo, array[p_good], to_jsonb(v_have)) end;

  update public.league_players
     set gold = v_player.gold,
         cargo = v_player.cargo,
         wealth = public.league_wealth(v_player.gold, v_player.cargo),
         updated_at = now()
   where user_id = auth.uid()
  returning * into v_player;

  insert into public.league_trades (user_id, town_id, good_id, amount, taler)
  values (auth.uid(), p_town, p_good, p_amount, v_taler);

  return jsonb_build_object(
    'stock', v_market.stock,
    'taler', v_taler,
    'gold', v_player.gold,
    'cargo', v_player.cargo,
    'wealth', v_player.wealth
  );
end;
$$;

revoke execute on function public.league_join() from public, anon;
revoke execute on function public.league_travel(text) from public, anon;
revoke execute on function public.league_trade(text, text, integer) from public, anon;
grant execute on function public.league_join() to authenticated;
grant execute on function public.league_travel(text) to authenticated;
grant execute on function public.league_trade(text, text, integer) to authenticated;

-- Startmarkt: Städte und Waren aus src/data/maps/m1.ts und src/data/goods.ts
insert into public.league_market (town_id, good_id, base_price, stock, target_stock, rest_stock) values
  ('niedermuend', 'getreide',  8, 180, 100, 180),
  ('niedermuend', 'holz',     10,  55, 100,  55),
  ('niedermuend', 'salz',     20, 190, 100, 190),
  ('oberau',      'getreide',  8,  75, 100,  75),
  ('oberau',      'holz',     10, 220, 100, 220),
  ('oberau',      'salz',     20,  60, 100,  60);

------------------------------------------------------------------------------
-- 5. Realtime
------------------------------------------------------------------------------

alter publication supabase_realtime add table public.league_market;
alter publication supabase_realtime add table public.league_players;

------------------------------------------------------------------------------
-- 6. Markterholung mit pg_cron (alle 10 Minuten)
------------------------------------------------------------------------------

create extension if not exists pg_cron;

-- FIX: Ganzzahldivision ließ den Bestand vor dem Ziel stehen bleiben.
-- Jetzt 15 % Richtung Ruhebestand wie dailyTick() im Einzelspiel, mindestens 1 Einheit.
create or replace function public.league_recover()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.league_market
     set stock = stock + sign(rest_stock - stock)::integer
                       * least(abs(rest_stock - stock), greatest(1, round(abs(rest_stock - stock) * 0.15)::integer)),
         updated_at = now()
   where stock <> rest_stock;
$$;

revoke execute on function public.league_recover() from public, anon, authenticated;

select cron.schedule('markt-erholung', '*/10 * * * *', 'select public.league_recover()');
