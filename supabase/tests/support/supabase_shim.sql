-- TEST-ONLY. Never applied to a real Supabase project.
--
-- A real Supabase project already has the roles, the `auth` schema and the default privileges that the
-- migrations rely on. This file recreates just enough of them in a plain local PostgreSQL server so that the
-- migrations and the row level security (RLS) policies can be executed and tested without Docker, without the
-- Supabase CLI and without any account. It is NOT Supabase: GoTrue (sign-in, token issue), PostgREST (the HTTP
-- API), Realtime, Storage and the dashboard are not reproduced. See supabase/tests/REAL_SUPABASE_CHECKS.md for
-- what only a real project can show.

create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

create schema auth;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_app_meta_data jsonb not null default '{}'::jsonb,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Same contract as Supabase: the claims come from the request.jwt.claims setting that PostgREST fills in.
create function auth.jwt() returns jsonb
  language sql stable
as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;

create function auth.uid() returns uuid
  language sql stable
as $$
  select nullif(
    coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (auth.jwt() ->> 'sub')),
    ''
  )::uuid
$$;

create function auth.role() returns text
  language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (auth.jwt() ->> 'role'),
    current_user::text
  )
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.jwt(), auth.uid(), auth.role() to anon, authenticated, service_role;

-- Supabase hands every new object in `public` to the three API roles by default; RLS is then the only gate.
-- Recreating that default makes the tests prove that the migrations' own REVOKE and GRANT statements hold.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
