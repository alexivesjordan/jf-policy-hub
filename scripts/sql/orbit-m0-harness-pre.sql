-- Throwaway roles and Supabase stubs so the migrations can run on plain Postgres.
-- Not applied to the hosted project.

create schema if not exists auth;
create schema if not exists storage;
create schema if not exists extensions;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end
$$;

grant anon, authenticated, service_role to postgres;
grant usage on schema auth, storage, public to anon, authenticated, service_role;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb,
  last_sign_in_at timestamptz
);

create table if not exists auth.sessions_test (
  id integer primary key default 1 check (id = 1),
  uid uuid,
  role text
);

insert into auth.sessions_test (id, uid, role)
values (1, null, null)
on conflict (id) do nothing;

create or replace function auth.uid()
returns uuid
language sql
stable
security definer
set search_path = auth
as $$
  select uid from auth.sessions_test where id = 1;
$$;

create or replace function auth.role()
returns text
language sql
stable
security definer
set search_path = auth
as $$
  select role from auth.sessions_test where id = 1;
$$;

grant execute on function auth.uid() to public, anon, authenticated, service_role;
grant execute on function auth.role() to public, anon, authenticated, service_role;

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text,
  name text,
  owner uuid,
  metadata jsonb
);

alter table storage.objects enable row level security;
grant all on storage.buckets, storage.objects to postgres, service_role;
