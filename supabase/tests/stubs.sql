-- Platzhalter für die Supabase-Teile, damit schema.sql in einer leeren lokalen Postgres-Datenbank läuft.
-- Nur für Tests, nie auf dem echten Projekt ausführen.
create role anon;
create role authenticated;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claims', true)::json->>'sub','')::uuid $$;
create schema cron;
create table cron.job (jobname text primary key, schedule text, command text);
create function cron.schedule(n text, s text, c text) returns bigint language sql as $$ insert into cron.job values (n,s,c) on conflict (jobname) do update set schedule=excluded.schedule, command=excluded.command; select 1::bigint $$;
create publication supabase_realtime;
