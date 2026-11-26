-- Two-step sign-in. An email code does not raise aal2.
-- HR salaries and cases still use hr.aal_ok().
-- New file only. Do not apply to production.

create table core.security_policy (
  id integer primary key default 1 check (id = 1),
  required_roles text[] not null default array['owner', 'admin', 'guest'],
  grace_days integer not null default 7 check (grace_days >= 0),
  member_domains text[] not null default array['jordanfitness.com']
);

insert into core.security_policy (id) values (1) on conflict (id) do nothing;

create table core.email_challenges (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create table core.verified_sessions (
  session_id text primary key,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  method text not null check (method in ('totp', 'email')),
  verified_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table core.trusted_devices (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  device_hash text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create or replace function core.code_hash(p_code text)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select encode(digest(convert_to(coalesce(p_code, ''), 'utf8'), 'sha256'), 'hex');
$$;

create or replace function core.session_verified()
returns boolean
language sql
stable
security definer
set search_path = core, public
as $$
  select coalesce(auth.jwt()->>'aal', '') = 'aal2'
    or exists (
      select 1
      from core.verified_sessions s
      where s.session_id = coalesce(auth.jwt()->>'session_id', '')
        and s.profile_id = auth.uid()
        and s.expires_at > now()
    );
$$;

create or replace function public.two_step_due()
returns boolean
language plpgsql
stable
security definer
set search_path = core, public, hr
as $$
declare
  v_role text;
  v_created timestamptz;
  v_grace integer;
  v_roles text[];
begin
  if auth.uid() is null or core.session_verified() then
    return false;
  end if;
  select workspace_role, created_at into v_role, v_created from public.profiles where id = auth.uid();
  select grace_days, required_roles into v_grace, v_roles from core.security_policy where id = 1;
  if v_created is null or now() < v_created + make_interval(days => coalesce(v_grace, 7)) then
    return false;
  end if;
  return v_role = any (coalesce(v_roles, array[]::text[]))
    or hr.is_director()
    or exists (
      select 1 from hr.employees manager
      join hr.employees report on report.manager_id = manager.id
      where manager.profile_id = auth.uid()
    );
end;
$$;

create or replace function public.email_code_start(p_code text)
returns void
language plpgsql
security definer
set search_path = core, public, extensions
as $$
declare
  v_recent integer;
begin
  if auth.uid() is null then
    raise exception 'app: Sign in first.';
  end if;
  if p_code !~ '^[0-9]{6}$' then
    raise exception 'app: Use a 6-digit code.';
  end if;
  select count(*) into v_recent
  from core.email_challenges
  where profile_id = auth.uid()
    and created_at > now() - interval '1 hour';
  if v_recent >= 5 then
    raise exception 'app: Too many codes. Try again later.';
  end if;
  insert into core.email_challenges (profile_id, code_hash, expires_at)
  values (auth.uid(), core.code_hash(p_code), now() + interval '10 minutes');
end;
$$;

create or replace function public.email_code_verify(p_code text)
returns boolean
language plpgsql
security definer
set search_path = core, public
as $$
declare
  v_row core.email_challenges%rowtype;
begin
  if auth.uid() is null then
    return false;
  end if;
  select * into v_row
  from core.email_challenges
  where profile_id = auth.uid()
    and consumed_at is null
  order by created_at desc
  limit 1;
  if v_row.id is null or v_row.attempts >= 5 then
    return false;
  end if;
  if v_row.expires_at <= now() then
    return false;
  end if;
  if v_row.code_hash is distinct from core.code_hash(p_code) then
    update core.email_challenges set attempts = attempts + 1 where id = v_row.id;
    return false;
  end if;
  update core.email_challenges set consumed_at = now() where id = v_row.id;
  insert into core.verified_sessions (session_id, profile_id, method, expires_at)
  values (coalesce(auth.jwt()->>'session_id', auth.uid()::text), auth.uid(), 'email', now() + interval '12 hours')
  on conflict (session_id) do update
    set method = 'email', verified_at = now(), expires_at = excluded.expires_at;
  return true;
end;
$$;

create or replace function public.trust_device(p_hash text)
returns void
language plpgsql
security definer
set search_path = core, public
as $$
begin
  if auth.uid() is null or length(coalesce(p_hash, '')) < 16 then
    raise exception 'app: That device was not recognised.';
  end if;
  insert into core.trusted_devices (profile_id, device_hash, expires_at)
  values (auth.uid(), p_hash, now() + interval '7 days');
end;
$$;

create or replace function public.device_trusted(p_hash text)
returns boolean
language sql
stable
security definer
set search_path = core, public
as $$
  select exists (
    select 1 from core.trusted_devices
    where profile_id = auth.uid()
      and device_hash = p_hash
      and expires_at > now()
  );
$$;

create or replace function public.revoke_trusted_devices()
returns void
language plpgsql
security definer
set search_path = core, public
as $$
begin
  delete from core.trusted_devices where profile_id = auth.uid();
  delete from core.verified_sessions where profile_id = auth.uid();
end;
$$;

revoke all on function core.code_hash(text) from public, anon;
revoke all on function core.session_verified() from public, anon;
revoke all on function public.two_step_due() from public, anon;
revoke all on function public.email_code_start(text) from public, anon;
revoke all on function public.email_code_verify(text) from public, anon;
revoke all on function public.trust_device(text) from public, anon;
revoke all on function public.device_trusted(text) from public, anon;
revoke all on function public.revoke_trusted_devices() from public, anon;
grant execute on function core.session_verified() to authenticated, service_role;
grant execute on function public.two_step_due() to authenticated, service_role;
grant execute on function public.email_code_start(text) to authenticated, service_role;
grant execute on function public.email_code_verify(text) to authenticated, service_role;
grant execute on function public.trust_device(text) to authenticated, service_role;
grant execute on function public.device_trusted(text) to authenticated, service_role;
grant execute on function public.revoke_trusted_devices() to authenticated, service_role;
