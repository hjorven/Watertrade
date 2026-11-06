-- Flussreich: Supabase-Schema (wird ab M3/M6 gebraucht, noch nicht angewendet)
-- Geprüfte Fassung des Plans, Abschnitt 7.2. Änderungen gegenüber dem Plan sind mit "FIX" markiert.

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique check (char_length(username) between 3 and 20),
  created_at timestamptz not null default now()
);

-- FIX: Profil automatisch bei der Registrierung anlegen.
-- Ohne Profil scheitert jedes Insert in saves/daily_results am Fremdschlüssel.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create table public.saves (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  slot smallint not null check (slot between 1 and 5),
  name text not null,
  data jsonb not null,
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

-- Online-Handelsliga
create table public.league_market (
  town_id text not null,
  good_id text not null,
  stock integer not null check (stock >= 0),
  target_stock integer not null check (target_stock > 0),
  updated_at timestamptz not null default now(),
  primary key (town_id, good_id)
);

create table public.league_players (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  wealth integer not null default 0,
  updated_at timestamptz not null default now()
);

create table public.league_trades (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  town_id text not null,
  good_id text not null,
  amount integer not null,
  created_at timestamptz not null default now()
);

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

-- Markt und Liga nur lesbar, geschrieben wird über die Funktion unten
create policy "markt lesbar" on public.league_market for select to authenticated using (true);
create policy "liga lesbar" on public.league_players for select to authenticated using (true);
create policy "eigene trades lesbar" on public.league_trades for select to authenticated
  using (user_id = (select auth.uid()));

-- Handel: positive Menge = an die Stadt verkaufen, negative = kaufen
create or replace function public.league_trade(p_town text, p_good text, p_amount integer)
returns integer
language plpgsql
security definer
set search_path = ''  -- FIX: leerer Suchpfad, alle Namen voll qualifiziert
as $$
declare
  v_stock integer;
begin
  if auth.uid() is null then
    raise exception 'nicht angemeldet';
  end if;

  if p_amount is null or p_amount = 0 or abs(p_amount) > 200 then
    raise exception 'ungueltige menge';
  end if;

  -- FIX: Kauf über den Bestand hinaus ablehnen statt still auf 0 zu kappen.
  -- Vorher bekam der Spieler 200 Einheiten, obwohl nur 5 da waren.
  update public.league_market
     set stock = stock + p_amount,
         updated_at = now()
   where town_id = p_town
     and good_id = p_good
     and stock + p_amount >= 0
  returning stock into v_stock;

  if not found then
    if exists (select 1 from public.league_market where town_id = p_town and good_id = p_good) then
      raise exception 'nicht genug bestand';
    end if;
    raise exception 'unbekannter markt';
  end if;

  insert into public.league_trades (user_id, town_id, good_id, amount)
  values (auth.uid(), p_town, p_good, p_amount);

  return v_stock;
end;
$$;

revoke execute on function public.league_trade(text, text, integer) from public, anon;
grant execute on function public.league_trade(text, text, integer) to authenticated;

alter publication supabase_realtime add table public.league_market;

-- Markterholung, erst nach Aktivieren der Erweiterung pg_cron ausführen:
-- FIX: Ganzzahldivision ließ den Bestand bis zu 9 Einheiten vor dem Ziel stehen bleiben.
-- Jetzt mindestens 1 Einheit Schritt, und nur Zeilen, die vom Ziel abweichen.
-- select cron.schedule(
--   'markt-erholung',
--   '*/10 * * * *',
--   $$update public.league_market
--        set stock = stock + sign(target_stock - stock)::integer
--                          * greatest(1, abs(target_stock - stock) / 10),
--            updated_at = now()
--      where stock <> target_stock$$
-- );
