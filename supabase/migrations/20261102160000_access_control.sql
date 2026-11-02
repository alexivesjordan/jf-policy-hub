-- Invite-only access for Jordan Orbit.
-- Existing accounts keep access. New accounts get in only when an
-- administrator has invited that @jordanfitness.com address.
-- alex.ives@jordanfitness.com stays an administrator.
-- Module licences live in module_access. Only People can be switched
-- on from the app today; the other Orbit modules are stored for later.

alter table public.profiles
  add column access_granted boolean not null default false,
  add column last_sign_in_at timestamptz;

comment on column public.profiles.access_granted is
  'True when an administrator has invited this person or they already had access before invites were required.';

comment on column public.profiles.last_sign_in_at is
  'Copied from auth.users.last_sign_in_at so the Users page can show it under RLS.';

-- People already using the app must not be locked out by this migration.
update public.profiles
set access_granted = true
where access_granted = false;

update public.profiles as p
set last_sign_in_at = u.last_sign_in_at
from auth.users as u
where u.id = p.id
  and u.last_sign_in_at is not null;

create table public.access_grants (
  email text primary key,
  full_name text,
  role text not null default 'staff' check (role in ('admin', 'approver', 'staff')),
  people_enabled boolean not null default true,
  invited_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint access_grants_email_domain check (email ~ '^[^@[:space:]]+@jordanfitness\.com$')
);

comment on table public.access_grants is
  'Invite recorded before the auth user exists, so the same email joins this account.';

create trigger access_grants_touch_updated_at
before update on public.access_grants
for each row execute function public.touch_updated_at();

create table public.module_access (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  module_id text not null check (module_id in ('people', 'service', 'supply', 'operations', 'sales', 'finance')),
  enabled boolean not null default false,
  primary key (profile_id, module_id)
);

comment on table public.module_access is
  'Licence per Orbit module. People is the only module the app can toggle today.';

insert into public.module_access (profile_id, module_id, enabled)
select p.id, m.module_id, m.module_id = 'people'
from public.profiles as p
cross join (
  values ('people'), ('service'), ('supply'), ('operations'), ('sales'), ('finance')
) as m(module_id);

insert into public.access_grants (email, full_name, role, people_enabled)
select lower(p.email), p.full_name, p.role, true
from public.profiles as p
where lower(p.email) ~ '^[^@[:space:]]+@jordanfitness\.com$'
on conflict (email) do nothing;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function private.seed_module_access(p_profile_id uuid, p_people boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.module_access (profile_id, module_id, enabled)
  values
    (p_profile_id, 'people', p_people),
    (p_profile_id, 'service', false),
    (p_profile_id, 'supply', false),
    (p_profile_id, 'operations', false),
    (p_profile_id, 'sales', false),
    (p_profile_id, 'finance', false)
  on conflict (profile_id, module_id) do update
    set enabled = excluded.enabled
    where public.module_access.module_id = 'people';
end;
$$;

revoke all on function private.seed_module_access(uuid, boolean) from public;

create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles as p
    where p.id = auth.uid()
      and p.is_active
      and p.access_granted
      and (
        p.role = 'admin'
        or exists (
          select 1
          from public.module_access as m
          where m.profile_id = p.id
            and m.module_id = 'people'
            and m.enabled
        )
      )
  );
$$;

create or replace function public.current_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role
  from public.profiles
  where id = auth.uid()
    and is_active
    and access_granted;
$$;

create or replace function private.approver_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(id), array[]::uuid[])
  from public.profiles
  where role in ('admin', 'approver')
    and is_active
    and access_granted;
$$;

-- ---------------------------------------------------------------------------
-- New auth users
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cleaned_email text := lower(trim(coalesce(new.email, '')));
  assigned_role text := 'staff';
  granted boolean := false;
  people_on boolean := false;
  display_name text := nullif(trim(coalesce(new.raw_user_meta_data->>'full_name', '')), '');
  grant_row public.access_grants%rowtype;
begin
  if cleaned_email = 'alex.ives@jordanfitness.com' then
    assigned_role := 'admin';
    granted := true;
    people_on := true;
  elsif cleaned_email ~ '^[^@[:space:]]+@jordanfitness\.com$' then
    select * into grant_row
    from public.access_grants
    where email = cleaned_email;

    if found then
      assigned_role := grant_row.role;
      granted := true;
      people_on := grant_row.people_enabled;
      display_name := coalesce(display_name, grant_row.full_name);
    end if;
  end if;

  insert into public.profiles (id, email, full_name, role, is_active, access_granted, last_sign_in_at)
  values (
    new.id,
    cleaned_email,
    display_name,
    assigned_role,
    true,
    granted,
    new.last_sign_in_at
  )
  on conflict (id) do nothing;

  perform private.seed_module_access(new.id, people_on);

  return new;
end;
$$;

create or replace function public.sync_last_sign_in()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('orbit.profile_sync', 'on', true);

  update public.profiles
  set last_sign_in_at = new.last_sign_in_at
  where id = new.id
    and last_sign_in_at is distinct from new.last_sign_in_at;

  return new;
end;
$$;

drop trigger if exists on_auth_user_sign_in on auth.users;

create trigger on_auth_user_sign_in
after update of last_sign_in_at on auth.users
for each row execute function public.sync_last_sign_in();

-- ---------------------------------------------------------------------------
-- Profile guards and audit
-- ---------------------------------------------------------------------------

create or replace function public.guard_profile_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  other_admins integer;
begin
  if lower(new.email) = 'alex.ives@jordanfitness.com' then
    new.role := 'admin';
    new.access_granted := true;
  end if;

  if tg_op = 'INSERT' then
    if lower(new.email) !~ '^[^@[:space:]]+@jordanfitness\.com$' then
      new.access_granted := false;
    end if;
    return new;
  end if;

  if current_setting('orbit.profile_sync', true) = 'on' then
    return new;
  end if;

  -- This function is security definer, so current_user is the owner.
  -- Use the caller's JWT role instead.
  if coalesce(auth.role(), '') is distinct from 'service_role'
     and not public.is_admin()
  then
    if auth.uid() is distinct from old.id
       or new.role is distinct from old.role
       or new.is_active is distinct from old.is_active
       or new.access_granted is distinct from old.access_granted
       or new.email is distinct from old.email
       or new.last_sign_in_at is distinct from old.last_sign_in_at
       or new.id is distinct from old.id
    then
      raise exception 'app: You can only change your own name.';
    end if;
  end if;

  if auth.uid() = old.id and old.is_active and not new.is_active then
    raise exception 'app: You cannot deactivate your own account.';
  end if;

  if auth.uid() = old.id and old.role = 'admin' and new.role is distinct from 'admin' then
    raise exception 'app: You cannot remove your own administrator access.';
  end if;

  if old.role = 'admin'
     and old.is_active
     and old.access_granted
     and (new.role is distinct from 'admin' or not new.is_active or not new.access_granted)
  then
    select count(*) into other_admins
    from public.profiles
    where role = 'admin'
      and is_active
      and access_granted
      and id <> old.id;

    if other_admins = 0 then
      raise exception 'app: Keep at least one active administrator.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_guard_write on public.profiles;

create trigger profiles_guard_write
before insert or update on public.profiles
for each row execute function public.guard_profile_write();

create or replace function public.audit_profile_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.role is distinct from new.role then
    insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
    values (
      auth.uid(),
      'user.role_changed',
      'profile',
      new.id,
      jsonb_build_object('from_role', old.role, 'to_role', new.role, 'email', new.email)
    );
  end if;

  if old.is_active is distinct from new.is_active then
    insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
    values (
      auth.uid(),
      case when new.is_active then 'user.reactivated' else 'user.deactivated' end,
      'profile',
      new.id,
      jsonb_build_object('email', new.email, 'role', new.role)
    );
  end if;

  return new;
end;
$$;

create or replace function public.audit_module_access()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.enabled is distinct from new.enabled then
    insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
    values (
      auth.uid(),
      'user.module_changed',
      'profile',
      new.profile_id,
      jsonb_build_object('module_id', new.module_id, 'enabled', new.enabled)
    );
  end if;

  return new;
end;
$$;

drop trigger if exists module_access_audit on public.module_access;

create trigger module_access_audit
after update on public.module_access
for each row execute function public.audit_module_access();

-- ---------------------------------------------------------------------------
-- Admin operations. The session must be an administrator. The service role
-- is not required for these writes; the app uses it only to send invite email.
-- ---------------------------------------------------------------------------

create or replace function public.admin_prepare_invite(
  p_email text,
  p_full_name text,
  p_role text,
  p_people_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_name text := nullif(trim(coalesce(p_full_name, '')), '');
  v_role text := p_role;
  v_people boolean := coalesce(p_people_enabled, true);
  v_user_id uuid;
  v_existing boolean := false;
begin
  if not public.is_admin() then
    raise exception 'app: Only an administrator can invite someone.';
  end if;

  if v_email !~ '^[^@[:space:]]+@jordanfitness\.com$' then
    raise exception 'app: Use a @jordanfitness.com email address.';
  end if;

  if v_role not in ('admin', 'approver', 'staff') then
    raise exception 'app: Choose a role.';
  end if;

  if v_email = 'alex.ives@jordanfitness.com' then
    v_role := 'admin';
    v_people := true;
  end if;

  insert into public.access_grants (email, full_name, role, people_enabled, invited_by)
  values (v_email, v_name, v_role, v_people, auth.uid())
  on conflict (email) do update
    set full_name = excluded.full_name,
        role = excluded.role,
        people_enabled = excluded.people_enabled,
        invited_by = excluded.invited_by,
        updated_at = now();

  select id into v_user_id
  from auth.users
  where lower(email) = v_email
  limit 1;

  if v_user_id is not null then
    v_existing := true;

    update public.profiles
    set full_name = coalesce(v_name, full_name),
        role = v_role,
        is_active = true,
        access_granted = true
    where id = v_user_id;

    perform private.seed_module_access(v_user_id, v_people);
  end if;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values (
    auth.uid(),
    'user.invited',
    'profile',
    v_user_id,
    jsonb_build_object(
      'email', v_email,
      'role', v_role,
      'people_enabled', v_people,
      'already_registered', v_existing
    )
  );

  return jsonb_build_object(
    'email', v_email,
    'role', v_role,
    'already_registered', v_existing,
    'user_id', v_user_id
  );
end;
$$;

create or replace function public.admin_update_member(
  p_user_id uuid,
  p_role text,
  p_is_active boolean,
  p_people_enabled boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_role text := p_role;
begin
  if not public.is_admin() then
    raise exception 'app: Only an administrator can change access.';
  end if;

  if v_role not in ('admin', 'approver', 'staff') then
    raise exception 'app: Choose a role.';
  end if;

  select email into v_email
  from public.profiles
  where id = p_user_id;

  if v_email is null then
    raise exception 'app: That person could not be found.';
  end if;

  if lower(v_email) = 'alex.ives@jordanfitness.com' then
    v_role := 'admin';
  end if;

  update public.profiles
  set role = v_role,
      is_active = p_is_active,
      access_granted = case when p_is_active then true else access_granted end
  where id = p_user_id;

  perform private.seed_module_access(p_user_id, coalesce(p_people_enabled, false));
end;
$$;

revoke all on function public.admin_prepare_invite(text, text, text, boolean) from public;
revoke all on function public.admin_update_member(uuid, text, boolean, boolean) from public;
revoke all on function public.guard_profile_write() from public;
revoke all on function public.sync_last_sign_in() from public;
revoke all on function public.audit_module_access() from public;

grant execute on function public.admin_prepare_invite(text, text, text, boolean) to authenticated;
grant execute on function public.admin_update_member(uuid, text, boolean, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Row level security for the new tables, and a tighter own-profile update.
-- ---------------------------------------------------------------------------

alter table public.access_grants enable row level security;
alter table public.module_access enable row level security;

revoke all on table public.access_grants from anon, authenticated;
revoke all on table public.module_access from anon, authenticated;

grant select on table public.module_access to authenticated;
grant all on table public.access_grants to service_role;
grant all on table public.module_access to service_role;

create policy "Read own module access"
on public.module_access
for select
to authenticated
using (profile_id = auth.uid());

create policy "Admins read module access"
on public.module_access
for select
to authenticated
using (public.is_admin());

drop policy if exists "Users update their own name" on public.profiles;

create policy "Users update their own name"
on public.profiles
for update
to authenticated
using (id = auth.uid() and public.is_active_user())
with check (
  id = auth.uid()
  and is_active = true
  and access_granted = true
  and role = public.current_role()
  and email = public.current_email()
);
