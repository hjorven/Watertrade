-- Tagesmarkt: pro Tag und Spieler genau ein gewerteter Versuch, Ergebnis nur über den Server.
--
-- Ablauf:
--   1. daily_begin(day) beim Start. Der erste Aufruf je Tag legt den Versuch an und ist gewertet,
--      jeder weitere ist nur noch eine Übungsrunde.
--   2. daily_submit(day, wealth) am Ende. Nur mit angelegtem Versuch, nur einmal, kein Verbessern.
-- Direktes Schreiben in daily_results ist nicht mehr erlaubt.

create table if not exists public.daily_attempts (
  day date not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  started_at timestamptz not null default now(),
  primary key (day, user_id)
);

alter table public.daily_attempts enable row level security;

drop policy if exists "eigene daily versuche lesbar" on public.daily_attempts;
create policy "eigene daily versuche lesbar" on public.daily_attempts for select to authenticated
  using (user_id = (select auth.uid()));

-- Nicht mehr direkt eintragen oder verbessern, nur noch über daily_submit
drop policy if exists "eigenes daily eintragen" on public.daily_results;
drop policy if exists "eigenes daily verbessern" on public.daily_results;

-- Versuch beginnen. Erlaubt ist der heutige Tag (UTC) und, kurz nach Mitternacht, der gestrige. Künftige Tage nie.
create or replace function public.daily_begin(p_day date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'utc')::date;
  v_started timestamptz;
  v_wealth integer;
  v_new boolean;
begin
  if auth.uid() is null then
    raise exception 'nicht angemeldet';
  end if;
  if p_day is null or p_day < v_today - 1 or p_day > v_today then
    raise exception 'tagesmarkt nicht von heute';
  end if;

  insert into public.daily_attempts (day, user_id)
  values (p_day, auth.uid())
  on conflict (day, user_id) do nothing;
  v_new := found;

  select started_at into v_started from public.daily_attempts where day = p_day and user_id = auth.uid();
  select wealth into v_wealth from public.daily_results where day = p_day and user_id = auth.uid();

  return jsonb_build_object('scored', v_new, 'started_at', v_started, 'wealth', v_wealth);
end;
$$;

-- Ergebnis eintragen. Zählt nur, wenn der Versuch begonnen wurde und noch kein Ergebnis existiert.
create or replace function public.daily_submit(p_day date, p_wealth integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_started timestamptz;
  v_wealth integer;
begin
  if auth.uid() is null then
    raise exception 'nicht angemeldet';
  end if;
  if p_wealth is null or p_wealth < 0 or p_wealth > 100000000 then
    raise exception 'ungültiges vermögen';
  end if;

  select started_at into v_started from public.daily_attempts where day = p_day and user_id = auth.uid();
  if v_started is null then
    raise exception 'kein gewerteter versuch';
  end if;
  -- Ein Versuch muss innerhalb von zwei Tagen abgeschlossen sein
  if now() > v_started + interval '2 days' then
    raise exception 'versuch abgelaufen';
  end if;

  insert into public.daily_results (day, user_id, wealth)
  values (p_day, auth.uid(), p_wealth)
  on conflict (day, user_id) do nothing;
  if found then
    return jsonb_build_object('accepted', true, 'wealth', p_wealth);
  end if;

  select wealth into v_wealth from public.daily_results where day = p_day and user_id = auth.uid();
  return jsonb_build_object('accepted', false, 'wealth', v_wealth);
end;
$$;

revoke execute on function public.daily_begin(date) from public, anon;
revoke execute on function public.daily_submit(date, integer) from public, anon;
grant execute on function public.daily_begin(date) to authenticated;
grant execute on function public.daily_submit(date, integer) to authenticated;
