-- Invitations for members and guests. Access grants stay readable.
-- Only a guest may use an email outside the company domain.
-- New file only. Do not apply to production.

create table core.invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  kind text not null check (kind in ('member', 'guest')),
  workspace_role text not null default 'member',
  organisation text,
  ends_on date,
  teams uuid[] not null default '{}',
  levels jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null default (now() + interval '14 days'),
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

insert into core.invitations (email, kind, workspace_role, expires_at, accepted_at)
select lower(g.email),
       'member',
       'member',
       g.created_at + interval '14 days',
       case when exists (select 1 from public.profiles p where lower(p.email) = lower(g.email)) then g.created_at else null end
from public.access_grants g
where not exists (
  select 1 from core.invitations i where lower(i.email) = lower(g.email) and i.kind = 'member'
);

create or replace function public.invite_email_allowed(p_email text, p_kind text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select case
    when p_kind = 'guest' then p_email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    else p_email ~* '^[^@[:space:]]+@jordanfitness\.com$'
  end;
$$;

create or replace function public.create_invitation(
  p_email text,
  p_kind text,
  p_organisation text,
  p_ends date
)
returns uuid
language plpgsql
security definer
set search_path = core, public
as $$
declare
  v_id uuid;
  v_email text := lower(trim(coalesce(p_email, '')));
begin
  if not public.workspace_is_admin() then
    raise exception 'app: Only a workspace owner or admin can invite.';
  end if;
  if p_kind not in ('member', 'guest') or not public.invite_email_allowed(v_email, p_kind) then
    raise exception 'app: That email cannot be invited.';
  end if;
  insert into core.invitations (email, kind, workspace_role, organisation, ends_on)
  values (v_email, p_kind, case when p_kind = 'guest' then 'guest' else 'member' end, nullif(trim(coalesce(p_organisation, '')), ''), p_ends)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.revoke_invitation(p_id uuid)
returns void
language plpgsql
security definer
set search_path = core, public
as $$
begin
  if not public.workspace_is_admin() then
    raise exception 'app: Only a workspace owner or admin can revoke an invite.';
  end if;
  update core.invitations set revoked_at = now() where id = p_id and revoked_at is null;
end;
$$;

create or replace function public.guest_blocked()
returns boolean
language sql
stable
security definer
set search_path = core, public
as $$
  select exists (
    select 1
    from public.profiles p
    join core.invitations i on lower(i.email) = lower(p.email) and i.kind = 'guest'
    where p.id = auth.uid()
      and p.workspace_role = 'guest'
      and (
        i.revoked_at is not null
        or (i.ends_on is not null and i.ends_on < current_date)
      )
  );
$$;

create or replace function public.guest_home_only()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and workspace_role = 'guest' and is_active
  );
$$;

revoke all on function public.guest_home_only() from public, anon;
revoke all on function public.invite_email_allowed(text, text) from public, anon;
revoke all on function public.create_invitation(text, text, text, date) from public, anon;
revoke all on function public.revoke_invitation(uuid) from public, anon;
revoke all on function public.guest_blocked() from public, anon;
grant execute on function public.guest_home_only() to authenticated, service_role;
grant execute on function public.invite_email_allowed(text, text) to authenticated, service_role;
grant execute on function public.create_invitation(text, text, text, date) to authenticated, service_role;
grant execute on function public.revoke_invitation(uuid) to authenticated, service_role;
grant execute on function public.guest_blocked() to authenticated, service_role;
