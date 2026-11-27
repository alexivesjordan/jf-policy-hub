-- Restores the function bodies from before 20261127400000_workspace_member_activity.sql.
-- Drops the two new functions. Does not delete audit rows.
-- Do not run on production. Test inside a transaction first.

drop function if exists public.workspace_member_activity(uuid, int, timestamptz);
drop function if exists public.workspace_log_invite_resent(text);

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

create or replace function public.workspace_prepare_invite(
  p_email text,
  p_first_name text,
  p_last_name text,
  p_workspace_role text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_first text := nullif(btrim(coalesce(p_first_name, '')), '');
  v_last text := nullif(btrim(coalesce(p_last_name, '')), '');
  v_workspace text := p_workspace_role;
  v_role text;
  v_user_id uuid;
  v_existing boolean := false;
  v_full text;
begin
  if not public.workspace_is_admin() then
    raise exception 'app: Only a workspace owner or admin can invite someone.';
  end if;
  if v_email !~ '^[^@[:space:]]+@jordanfitness\.com$' then
    raise exception 'app: Use a @jordanfitness.com email address.';
  end if;
  if v_first is null or v_last is null or char_length(v_first) > 80 or char_length(v_last) > 80 then
    raise exception 'app: Enter a first and last name.';
  end if;
  if v_workspace not in ('owner', 'admin', 'manager', 'member', 'viewer') then
    raise exception 'app: Choose a workspace role.';
  end if;
  v_role := case
    when v_workspace in ('owner', 'admin') then 'admin'
    when v_workspace = 'manager' then 'approver'
    else 'staff'
  end;
  v_full := v_first || ' ' || v_last;

  insert into public.access_grants (email, full_name, first_name, last_name, role, people_enabled, invited_by)
  values (v_email, v_full, v_first, v_last, v_role, true, auth.uid())
  on conflict (email) do update
    set full_name = excluded.full_name,
        first_name = excluded.first_name,
        last_name = excluded.last_name,
        role = excluded.role,
        people_enabled = true,
        invited_by = excluded.invited_by,
        updated_at = now();

  select id into v_user_id from auth.users where lower(email) = v_email limit 1;
  if v_user_id is not null then
    v_existing := true;
    update public.profiles
    set first_name = v_first,
        last_name = v_last,
        role = v_role,
        workspace_role = v_workspace,
        access_mode = 'follow',
        is_active = true,
        access_granted = true
    where id = v_user_id;
    perform private.seed_module_access(v_user_id, true);
  end if;

  perform public.write_access_audit(
    'user.invited', 'profile', v_user_id, null,
    jsonb_build_object('email', v_email, 'first_name', v_first, 'last_name', v_last, 'workspace_role', v_workspace, 'already_registered', v_existing)
  );

  return jsonb_build_object('email', v_email, 'role', v_role, 'already_registered', v_existing, 'user_id', v_user_id);
end;
$$;

revoke all on function public.workspace_prepare_invite(text, text, text, text) from public, anon;
grant execute on function public.workspace_prepare_invite(text, text, text, text) to authenticated, service_role;

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

revoke all on function public.create_invitation(text, text, text, date) from public, anon;
revoke all on function public.revoke_invitation(uuid) from public, anon;
grant execute on function public.create_invitation(text, text, text, date) to authenticated, service_role;
grant execute on function public.revoke_invitation(uuid) to authenticated, service_role;

create or replace function public.workspace_revoke_invite(p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
begin
  if not public.workspace_is_admin() then
    raise exception 'app: Only a workspace owner or admin can revoke an invite.';
  end if;
  if exists (select 1 from public.profiles p where lower(p.email) = v_email) then
    raise exception 'app: That person has already joined.';
  end if;
  delete from public.access_grants where lower(email) = v_email;
end;
$$;

revoke all on function public.workspace_revoke_invite(text) from public, anon;
grant execute on function public.workspace_revoke_invite(text) to authenticated, service_role;
