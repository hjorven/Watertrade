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
