-- Test der Liga-Saisons (Migration 20261106210000_liga_saisons.sql) in einer lokalen Postgres-Datenbank.
-- Ablauf (alles in einer frischen, leeren Datenbank "liga"):
--   psql -d liga -f supabase/tests/stubs.sql
--   grep -v "create extension if not exists pg_cron" supabase/schema.sql | psql -d liga -v ON_ERROR_STOP=1
--   psql -d liga -f supabase/migrations/20261106190000_liga_ganzes_tal.sql
--   psql -d liga -c "insert into auth.users values ('11111111-1111-1111-1111-111111111111')"
--   psql -d liga -f supabase/tests/liga_saisons_test.sql
-- Der Block endet absichtlich mit einer Ausnahme "ERGEBNIS ...", damit alle Änderungen zurückgerollt werden.
-- Erwartet: kauf5 brot=277, verkauf5 mit zoll=204, plaette gold=720 wealth=860, reise dauer=30 s,
-- rate: zu viele aktionen, halle=1/1/999/1, spieler=0, maerkte abweichend=0, drei Cron-Jobs.
do $t$
declare
  u uuid;
  p record;
  r jsonb;
  out text := '';
  n integer;
  e text;
begin
  select id into u from public.profiles limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  p := public.league_join();
  out := out || format('join ship=%s town=%s gold=%s; ', p.ship, p.town_id, p.gold);
  -- Kauf normal
  r := public.league_trade(p.town_id, 'brot', -5);
  out := out || format('kauf5 brot=%s; ', r->>'taler');
  -- Zollstreit in dieser Stadt
  insert into public.league_events (kind, town_id, starts_at, ends_at) values ('zollstreit', p.town_id, now() - interval '1 minute', now() + interval '1 hour');
  r := public.league_trade(p.town_id, 'brot', 5);
  out := out || format('verkauf5 mit zoll=%s wealth=%s; ', r->>'taler', r->>'wealth');
  -- Schiff kaufen
  out := out || format('gold=%s; ', (select gold from public.league_players where user_id=u));
  begin
    p := public.league_buy_ship('segelkahn');
  exception when others then out := out || 'segelkahn: ' || sqlerrm || '; ';
  end;
  update public.league_players set gold = 1000 where user_id = u;
  p := public.league_buy_ship('plaette');
  out := out || format('plaette gold=%s wealth=%s ship=%s; ', p.gold, p.wealth, p.ship);
  begin
    p := public.league_buy_ship('plaette');
  exception when others then out := out || 'nochmal: ' || sqlerrm || '; ';
  end;
  -- Hochwasser, Reise
  insert into public.league_events (kind, starts_at, ends_at) values ('hochwasser', now() - interval '1 minute', now() + interval '1 hour');
  p := public.league_travel('oberau');
  out := out || format('reise dauer=%s s; ', extract(epoch from p.arrives_at - p.departed_at));
  begin
    p := public.league_travel('weidenhof');
  exception when others then out := out || 'unterwegs: ' || sqlerrm || '; ';
  end;
  -- Ratenbegrenzung
  select rate_count into n from public.league_players where user_id = u;
  out := out || format('zaehler=%s; ', n);
  update public.league_players set rate_count = 40 where user_id = u;
  begin
    p := public.league_travel('oberau');
  exception when others then out := out || 'rate: ' || sqlerrm || '; ';
  end;
  update public.league_players set rate_window = now() - interval '61 seconds', arrives_at = now() - interval '1 second' where user_id = u;
  p := public.league_travel('oberau');
  out := out || format('nach fenster zaehler=%s; ', p.rate_count);
  -- Ereignis-Tick: läuft gerade eines -> nichts
  perform public.league_event_tick();
  select count(*) into n from public.league_events;
  out := out || format('events=%s; ', n);
  delete from public.league_events where true;
  for i in 1..10 loop perform public.league_event_tick(); end loop;
  select string_agg(kind || coalesce(':' || town_id, '') || ' ' || round(extract(epoch from ends_at - starts_at)/60), ',') into e from public.league_events;
  out := out || format('neue events=%s; ', e);
  -- Saison
  update public.league_players set wealth = 999 where user_id = u;
  update public.league_seasons set ends_at = now() - interval '30 days', starts_at = now() - interval '40 days';
  perform public.league_season_tick();
  select string_agg(id || ':' || starts_at::date || '-' || ends_at::date, ',') into e from public.league_seasons;
  out := out || format('saisons=%s; ', e);
  select string_agg(season_id || '/' || rank || '/' || wealth || '/' || players, ',') into e from public.league_hall_of_fame;
  out := out || format('halle=%s; ', e);
  select count(*) into n from public.league_players;
  out := out || format('spieler=%s; ', n);
  select count(*) into n from public.league_market where stock <> rest_stock;
  out := out || format('maerkte abweichend=%s; ', n);
  select string_agg(jobname || ' ' || schedule, ',') into e from cron.job;
  out := out || format('cron=%s', e);
  raise exception 'ERGEBNIS %', out;
end
$t$;
