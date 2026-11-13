-- Installs-team logins are field engineers until an admin marks them as office staff.
-- Slots in before 20261113240000.

create table ops.install_office_staff (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  marked_by uuid,
  marked_at timestamptz not null default now()
);

alter table ops.install_office_staff enable row level security;
revoke all on ops.install_office_staff from public, anon, authenticated;

create table ops.install_invite_choices (
  email text primary key,
  choice text not null,
  team_ids uuid[] not null default '{}',
  created_at timestamptz not null default now()
);

alter table ops.install_invite_choices enable row level security;
revoke all on ops.install_invite_choices from public, anon, authenticated;

create or replace function ops.is_field_engineer()
returns boolean
language sql
stable
security definer
set search_path = ops, public
as $$
  select auth.uid() is not null
    and not public.workspace_is_admin()
    and not exists (
      select 1 from ops.install_office_staff s where s.profile_id = auth.uid()
    )
    and (
      exists (
        select 1 from ops.resources r
        where r.profile_id = auth.uid()
          and r.resource_type in ('installer', 'helper')
          and r.status = 'active'
      )
      or exists (
        select 1
        from public.workspace_team_members m
        join public.workspace_teams t on t.id = m.team_id
        where m.profile_id = auth.uid()
          and t.name = 'Installs'
      )
    );
$$;

revoke all on function ops.is_field_engineer() from public, anon, authenticated;

create or replace function ops.apply_install_choice(p_profile uuid, p_choice text)
returns void
language plpgsql
security definer
set search_path = ops, public
as $$
declare
  v_choice text := nullif(btrim(coalesce(p_choice, '')), '');
begin
  if p_profile is null then
    return;
  end if;
  if v_choice is null then
    delete from ops.install_office_staff where profile_id = p_profile;
    update ops.resources
    set profile_id = null
    where profile_id = p_profile
      and resource_type in ('installer', 'helper');
    return;
  end if;
  if v_choice = 'office' then
    update ops.resources
    set profile_id = null
    where profile_id = p_profile
      and resource_type in ('installer', 'helper');
    insert into ops.install_office_staff (profile_id, marked_by)
    values (p_profile, auth.uid())
    on conflict (profile_id) do update
    set marked_by = excluded.marked_by, marked_at = now();
    return;
  end if;
  if v_choice !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'app: Choose a field engineer.';
  end if;
  if not exists (
    select 1 from ops.resources
    where id = v_choice::uuid
      and resource_type in ('installer', 'helper')
      and status = 'active'
  ) then
    raise exception 'app: Choose a field engineer.';
  end if;
  delete from ops.install_office_staff where profile_id = p_profile;
  update ops.resources
  set profile_id = null
  where profile_id = p_profile
    and resource_type in ('installer', 'helper')
    and id is distinct from v_choice::uuid;
  update ops.resources set profile_id = p_profile where id = v_choice::uuid;
end;
$$;

revoke all on function ops.apply_install_choice(uuid, text) from public, anon, authenticated;

create or replace function public.install_choice_ok(p_choice text)
returns boolean
language plpgsql
stable
security definer
set search_path = ops, public
as $$
begin
  if coalesce(p_choice, '') = 'office' then
    return true;
  end if;
  if coalesce(p_choice, '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return exists (
    select 1 from ops.resources r
    where r.id = p_choice::uuid
      and r.resource_type in ('installer', 'helper')
      and r.status = 'active'
  );
end;
$$;

revoke all on function public.install_choice_ok(text) from public, anon, authenticated;

drop function if exists public.install_set_field_resource(uuid, uuid);

create or replace function public.install_set_field_resource(p_profile uuid, p_choice text)
returns void
language plpgsql
security definer
set search_path = ops, public
as $$
begin
  if ops.is_field_engineer() and not public.workspace_is_admin() then
    raise exception 'app: You cannot change that link.';
  end if;
  if not public.workspace_is_admin() then
    raise exception 'app: You cannot change that link.';
  end if;
  if p_profile is null or not exists (select 1 from public.profiles where id = p_profile) then
    raise exception 'app: That person was not found.';
  end if;
  perform ops.apply_install_choice(p_profile, p_choice);
end;
$$;

create or replace function public.install_field_resources()
returns jsonb
language plpgsql
security definer
set search_path = ops, public
as $$
begin
  if ops.is_field_engineer() and not public.workspace_is_admin() then
    raise exception 'app: You cannot view engineer logins.';
  end if;
  if not public.workspace_is_admin() then
    raise exception 'app: You cannot view engineer logins.';
  end if;
  return jsonb_build_object(
    'resources', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'name', r.name,
        'profileId', r.profile_id
      ) order by r.name)
      from ops.resources r
      where r.resource_type in ('installer', 'helper')
        and r.status = 'active'
    ), '[]'::jsonb),
    'officeIds', coalesce((
      select jsonb_agg(s.profile_id order by s.profile_id)
      from ops.install_office_staff s
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.install_apply_invite(p_email text, p_team_ids uuid[], p_choice text)
returns void
language plpgsql
security definer
set search_path = ops, public
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_choice text := nullif(btrim(coalesce(p_choice, '')), '');
  v_profile uuid;
  v_installs boolean;
begin
  if ops.is_field_engineer() and not public.workspace_is_admin() then
    raise exception 'app: You cannot change that link.';
  end if;
  if not public.workspace_is_admin() then
    raise exception 'app: You cannot change that link.';
  end if;
  v_installs := exists (
    select 1 from public.workspace_teams t
    where t.id = any (coalesce(p_team_ids, '{}'))
      and t.name = 'Installs'
  );
  if v_installs and not public.install_choice_ok(v_choice) then
    raise exception 'app: Choose a field engineer resource, or mark them as office staff.';
  end if;
  if v_choice is not null and v_choice <> 'office' and not public.install_choice_ok(v_choice) then
    raise exception 'app: Choose a field engineer.';
  end if;
  insert into ops.install_invite_choices (email, choice, team_ids)
  values (v_email, coalesce(v_choice, ''), coalesce(p_team_ids, '{}'))
  on conflict (email) do update
  set choice = excluded.choice, team_ids = excluded.team_ids, created_at = now();
  select id into v_profile from public.profiles where lower(email) = v_email;
  if v_profile is null then
    return;
  end if;
  insert into public.workspace_team_members (team_id, profile_id)
  select tid, v_profile
  from unnest(coalesce(p_team_ids, '{}')) as tid
  join public.workspace_teams t on t.id = tid
  on conflict do nothing;
  if v_choice is not null then
    perform ops.apply_install_choice(v_profile, v_choice);
  end if;
  delete from ops.install_invite_choices where email = v_email;
end;
$$;

create or replace function ops.apply_install_invite_choice()
returns trigger
language plpgsql
security definer
set search_path = ops, public
as $$
declare
  v_row ops.install_invite_choices%rowtype;
begin
  select * into v_row from ops.install_invite_choices where email = lower(new.email);
  if not found then
    return new;
  end if;
  insert into public.workspace_team_members (team_id, profile_id)
  select tid, new.id
  from unnest(coalesce(v_row.team_ids, '{}')) as tid
  join public.workspace_teams t on t.id = tid
  on conflict do nothing;
  if v_row.choice = 'office' or public.install_choice_ok(nullif(v_row.choice, '')) then
    perform ops.apply_install_choice(new.id, nullif(v_row.choice, ''));
  end if;
  delete from ops.install_invite_choices where email = lower(new.email);
  return new;
end;
$$;

revoke all on function ops.apply_install_invite_choice() from public, anon, authenticated;

drop trigger if exists install_invite_choice on public.profiles;
create trigger install_invite_choice
after insert on public.profiles
for each row execute function ops.apply_install_invite_choice();

create or replace function public.install_field_home()
returns jsonb
language plpgsql
security definer
set search_path = ops, public
as $$
declare
  v_today date := (timezone('Europe/London', now()))::date;
  v_all boolean;
  v_role text;
  v_linked boolean;
begin
  if auth.uid() is null then
    raise exception 'app: You need to be signed in.';
  end if;
  v_all := public.install_sees_all();
  v_linked := exists (
    select 1 from ops.resources r
    where r.profile_id = auth.uid()
      and r.resource_type in ('installer', 'helper')
      and r.status = 'active'
  );
  v_role := case
    when public.workspace_is_admin() then 'admin'
    when ops.is_field_engineer() then 'engineer'
    when v_all then 'ops'
    else 'none'
  end;
  return jsonb_build_object(
    'role', v_role,
    'needsLink', v_role = 'engineer' and not v_linked,
    'jobs', coalesce((
      select jsonb_agg(item order by sort_group, start_on, order_number)
      from (
        select
          case when v_today between i.start_on and i.end_on then 0 when i.start_on > v_today then 1 else 2 end as sort_group,
          i.start_on,
          i.order_number,
          jsonb_build_object(
            'id', i.id,
            'orderNumber', i.order_number,
            'customerName', i.customer_name,
            'siteAddress', i.site_address,
            'startOn', i.start_on,
            'endOn', i.end_on,
            'status', i.status,
            'today', v_today between i.start_on and i.end_on,
            'assigneeNames', coalesce((
              select jsonb_agg(name order by name)
              from (
                select distinct r.name
                from ops.install_reservations ir
                join ops.resources r on r.id = ir.resource_id
                where ir.install_id = i.id and r.resource_type in ('installer', 'helper')
              ) names
            ), '[]'::jsonb)
          ) as item
        from ops.installs i
        where i.status <> 'cancelled'
          and (v_all or ops.install_assigned(i.id, auth.uid()))
          and v_role <> 'none'
      ) listed
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.save_person_name(p_profile uuid, p_first_name text, p_last_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_first text := nullif(btrim(coalesce(p_first_name, '')), '');
  v_last text := btrim(coalesce(p_last_name, ''));
  v_before jsonb;
  v_after jsonb;
begin
  if auth.uid() is null then
    raise exception 'app: You need to be signed in.';
  end if;
  if p_profile is distinct from auth.uid() and not public.workspace_is_admin() then
    raise exception 'app: You can only change your own name.';
  end if;
  if v_first is null or char_length(v_first) > 80 or char_length(v_last) > 80 then
    raise exception 'app: Enter a first name.';
  end if;
  if v_last = '' then
    raise exception 'app: Enter a last name.';
  end if;
  select jsonb_build_object('first_name', first_name, 'last_name', last_name) into v_before
  from public.profiles where id = p_profile;
  if v_before is null then
    raise exception 'app: That person could not be found.';
  end if;
  update public.profiles set first_name = v_first, last_name = v_last where id = p_profile;
  v_after := jsonb_build_object('first_name', v_first, 'last_name', v_last);
  perform public.write_access_audit('user.name_changed', 'profile', p_profile, v_before, v_after);
end;
$$;

revoke all on function public.install_set_field_resource(uuid, text) from public, anon;
revoke all on function public.install_apply_invite(text, uuid[], text) from public, anon;
grant execute on function public.install_set_field_resource(uuid, text) to authenticated, service_role;
grant execute on function public.install_apply_invite(text, uuid[], text) to authenticated, service_role;
