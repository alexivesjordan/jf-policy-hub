-- Member activity for one person, plus sign-in and invite audit writes.
-- Additive: workspace_member_activity and workspace_log_invite_resent.
-- Replaces the bodies of sync_last_sign_in, workspace_prepare_invite,
-- create_invitation, revoke_invitation and workspace_revoke_invite.
-- No tables, columns, or rows are dropped or rewritten.
-- New file only. Do not apply to production.

create or replace function public.workspace_member_activity(
  p_id uuid,
  p_limit int default 50,
  p_before timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row public.profiles%rowtype;
  v_limit int := coalesce(p_limit, 50);
  v_events jsonb;
begin
  if not public.workspace_is_admin() then
    raise exception 'app: Only a workspace owner or admin can open this.';
  end if;
  if v_limit < 1 then
    v_limit := 50;
  end if;

  select * into v_row from public.profiles where id = p_id;
  if v_row.id is null then
    raise exception 'app: That person was not found.';
  end if;

  with events as (
    select
      a.id,
      a.created_at as at,
      a.action,
      a.actor_id,
      coalesce(nullif(btrim(actor.full_name), ''), actor.email) as actor_name,
      a.entity_type,
      a.entity_id,
      a.before,
      a.after
    from public.access_audit_log a
    left join public.profiles actor on actor.id = a.actor_id
    where a.action in (
      'user.invited',
      'user.invite_resent',
      'user.invite_revoked',
      'user.access_changed',
      'user.name_changed',
      'user.deleted',
      'user.signed_in'
    )
    and (
      a.entity_id = p_id
      or (
        a.entity_type = 'profile'
        and lower(coalesce(a.after->>'email', a.before->>'email')) = lower(v_row.email)
      )
    )

    union all

    select
      l.id,
      l.created_at,
      l.action,
      l.actor_id,
      coalesce(nullif(btrim(actor.full_name), ''), actor.email),
      l.entity_type,
      l.entity_id,
      null::jsonb,
      l.details
    from public.audit_log l
    left join public.profiles actor on actor.id = l.actor_id
    where l.entity_type = 'profile'
      and l.entity_id = p_id
      and l.action in ('user.role_changed', 'user.module_changed', 'user.deactivated')

    union all

    select
      md5(v_row.id::text || '|signed_in|' || v_row.last_sign_in_at::text)::uuid,
      v_row.last_sign_in_at,
      'user.signed_in',
      v_row.id,
      coalesce(nullif(btrim(v_row.full_name), ''), v_row.email),
      'profile',
      v_row.id,
      null::jsonb,
      jsonb_build_object('at', v_row.last_sign_in_at)
    where v_row.last_sign_in_at is not null
      and not exists (
        select 1
        from public.access_audit_log s
        where s.action = 'user.signed_in'
          and (
            s.entity_id = v_row.id
            or (
              s.entity_type = 'profile'
              and lower(coalesce(s.after->>'email', s.before->>'email')) = lower(v_row.email)
            )
          )
          and (
            s.created_at = v_row.last_sign_in_at
            or (
              coalesce(s.after->>'at', '') ~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}'
              and (s.after->>'at')::timestamptz = v_row.last_sign_in_at
            )
          )
      )
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', page.id,
        'at', page.at,
        'action', page.action,
        'actor_id', page.actor_id,
        'actor_name', page.actor_name,
        'entity_type', page.entity_type,
        'entity_id', page.entity_id,
        'before', page.before,
        'after', page.after
      )
      order by page.at desc, page.id desc
    ),
    '[]'::jsonb
  )
  into v_events
  from (
    select *
    from events
    where p_before is null or events.at < p_before
    order by events.at desc, events.id desc
    limit v_limit
  ) page;

  return v_events;
end;
$$;

comment on function public.workspace_member_activity(uuid, int, timestamptz) is
  'Newest-first activity for one person. Owners and admins only. A missing sign-in row is returned, not inserted.';

revoke all on function public.workspace_member_activity(uuid, int, timestamptz) from public, anon;
grant execute on function public.workspace_member_activity(uuid, int, timestamptz) to authenticated, service_role;

create or replace function public.workspace_log_invite_resent(p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_profile uuid;
begin
  if not public.workspace_is_admin() then
    raise exception 'app: Only a workspace owner or admin can resend an invite.';
  end if;
  if v_email = '' then
    raise exception 'app: Enter an email address.';
  end if;
  select id into v_profile
  from public.profiles
  where lower(email) = v_email
  limit 1;
  perform public.write_access_audit(
    'user.invite_resent',
    'profile',
    v_profile,
    null,
    jsonb_build_object('email', v_email)
  );
end;
$$;

comment on function public.workspace_log_invite_resent(text) is
  'Records that an invite email was sent again. Owners and admins only.';

revoke all on function public.workspace_log_invite_resent(text) from public, anon;
grant execute on function public.workspace_log_invite_resent(text) to authenticated, service_role;

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

  if found then
    perform public.write_access_audit(
      'user.signed_in',
      'profile',
      new.id,
      null,
      jsonb_build_object('at', new.last_sign_in_at)
    );
  end if;

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
  v_profile_id uuid;
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

  select id into v_profile_id
  from public.profiles
  where id = v_user_id or lower(email) = v_email
  order by case when id = v_user_id then 0 else 1 end
  limit 1;

  perform public.write_access_audit(
    'user.invited', 'profile', v_profile_id, null,
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
  v_profile uuid;
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
  select id into v_profile from public.profiles where lower(email) = v_email limit 1;
  perform public.write_access_audit(
    'user.invited',
    'profile',
    v_profile,
    null,
    jsonb_build_object('email', v_email, 'kind', p_kind)
  );
  return v_id;
end;
$$;

create or replace function public.revoke_invitation(p_id uuid)
returns void
language plpgsql
security definer
set search_path = core, public
as $$
declare
  v_email text;
  v_profile uuid;
begin
  if not public.workspace_is_admin() then
    raise exception 'app: Only a workspace owner or admin can revoke an invite.';
  end if;
  update core.invitations
  set revoked_at = now()
  where id = p_id and revoked_at is null
  returning lower(email) into v_email;
  if found then
    select id into v_profile from public.profiles where lower(email) = v_email limit 1;
    perform public.write_access_audit(
      'user.invite_revoked',
      'profile',
      v_profile,
      null,
      jsonb_build_object('email', v_email)
    );
  end if;
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
  v_profile uuid;
begin
  if not public.workspace_is_admin() then
    raise exception 'app: Only a workspace owner or admin can revoke an invite.';
  end if;
  if exists (select 1 from public.profiles p where lower(p.email) = v_email) then
    raise exception 'app: That person has already joined.';
  end if;
  delete from public.access_grants where lower(email) = v_email;
  if found then
    select id into v_profile from public.profiles where lower(email) = v_email limit 1;
    perform public.write_access_audit(
      'user.invite_revoked',
      'profile',
      v_profile,
      null,
      jsonb_build_object('email', v_email)
    );
  end if;
end;
$$;

revoke all on function public.workspace_revoke_invite(text) from public, anon;
grant execute on function public.workspace_revoke_invite(text) to authenticated, service_role;
