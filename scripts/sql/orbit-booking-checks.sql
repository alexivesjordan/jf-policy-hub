-- Required-resource permissions. Runs after the migrations on the throwaway database.

insert into public.access_grants (email, full_name, role, people_enabled)
values ('simon.ops@jordanfitness.com', 'Simon Ops', 'staff', true);

insert into auth.users (id, email, raw_user_meta_data)
values ('88888888-8888-4888-8888-888888888888', 'simon.ops@jordanfitness.com', '{}'::jsonb);

update public.module_access
set enabled = true
where module_id = 'operations'
  and profile_id = '88888888-8888-4888-8888-888888888888';

insert into core.ops_roles (profile_id, ops_role, is_owner)
values ('88888888-8888-4888-8888-888888888888', 'ops_manager', false);

update auth.sessions_test
set uid = null, role = 'service_role'
where id = 1;

select public.orbit_save_job_requirements(
  'f2000000-0000-4000-8000-000000000001',
  2, 1, 'small', 1, true
);

do $$
begin
  update auth.sessions_test set uid = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', role = 'authenticated' where id = 1;
  begin
    perform public.orbit_override_requirements(
      'f2000000-0000-4000-8000-000000000001',
      3, 1, 'small', 1, true
    );
    raise exception 'sales override should have been rejected';
  exception
    when others then
      if sqlerrm not like '%cannot change required resources%' then
        raise;
      end if;
  end;
end
$$;

do $$
declare
  v_count integer;
begin
  update auth.sessions_test set uid = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', role = 'authenticated' where id = 1;
  begin
    set local role authenticated;
    update ops.job_requirements
    set installers = 9
    where job_id = 'f2000000-0000-4000-8000-000000000001';
    get diagnostics v_count = row_count;
    if v_count <> 0 then
      raise exception 'sales update changed % rows', v_count;
    end if;
  exception
    when insufficient_privilege then
      null;
  end;
end
$$;

do $$
declare
  v_installers integer;
begin
  select installers into v_installers
  from ops.job_requirements
  where job_id = 'f2000000-0000-4000-8000-000000000001';
  if v_installers is distinct from 2 then
    raise exception 'sales update changed required resources to %', v_installers;
  end if;
end
$$;

update auth.sessions_test
set uid = '88888888-8888-4888-8888-888888888888', role = 'authenticated'
where id = 1;

select public.orbit_override_requirements(
  'f2000000-0000-4000-8000-000000000001',
  2, 1, 'small', 1, false
);

do $$
begin
  if not exists (
    select 1 from core.audit_log
    where entity_table = 'job_requirements'
      and entity_id = 'f2000000-0000-4000-8000-000000000001'
      and actor_id = '88888888-8888-4888-8888-888888888888'
  ) then
    raise exception 'ops manager override was not audited';
  end if;
end
$$;

update ops.install_jobs
set owner_rep_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
where id = 'f2000000-0000-4000-8000-000000000001';

update auth.sessions_test
set uid = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', role = 'authenticated'
where id = 1;

select public.orbit_pencil_day(
  'f2000000-0000-4000-8000-000000000001',
  date '2026-11-16',
  array[
    'f3000000-0000-4000-8000-000000000001',
    'f3000000-0000-4000-8000-000000000002',
    'f3000000-0000-4000-8000-000000000005'
  ]::uuid[]
);

do $$
declare
  v_status ops.job_status;
  v_kind text;
begin
  select status into v_status from ops.install_jobs where id = 'f2000000-0000-4000-8000-000000000001';
  if v_status <> 'priced' then
    raise exception 'pencil booking changed status to %', v_status;
  end if;
  select kind into v_kind
  from ops.reservations
  where job_id = 'f2000000-0000-4000-8000-000000000001'
  limit 1;
  if v_kind <> 'pencil' then
    raise exception 'booking kind was %', v_kind;
  end if;
end
$$;

update auth.sessions_test
set uid = '88888888-8888-4888-8888-888888888888', role = 'authenticated'
where id = 1;

select public.orbit_override_requirements(
  'f2000000-0000-4000-8000-000000000001',
  2, 1, 'small', 1, true
);

do $$
begin
  update auth.sessions_test set uid = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', role = 'authenticated' where id = 1;
  begin
    perform public.orbit_save_category_effort_defaults(
      '[{"category":"bench","build_crew":2,"build_minutes":90,"note":"changed"}]'::jsonb,
      'sales should not edit this'
    );
    raise exception 'sales edit of effort defaults should have been rejected';
  exception
    when others then
      if sqlerrm not like '%Only the owner can change category effort defaults%' then
        raise;
      end if;
  end;
end
$$;

update auth.sessions_test set uid = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', role = 'authenticated' where id = 1;

select public.orbit_save_category_effort_defaults(
  '[{"category":"bench","build_crew":2,"build_minutes":120,"note":"Each machine: 2-man, 2-hour build."}]'::jsonb,
  'owner keeps the worked-example assumption'
);

do $$
declare
  v_version integer;
begin
  select max(version) into v_version from ops.category_effort_defaults where category = 'bench';
  if v_version is distinct from 2 then
    raise exception 'owner save did not append a category effort version (got %)', v_version;
  end if;
  if exists (select 1 from ops.category_effort_defaults where version = 1 and category = 'bench' and build_minutes <> 120) then
    raise exception 'the seeded effort version was overwritten';
  end if;
end
$$;

do $$
declare
  v_conflict boolean;
begin
  select conflict into v_conflict
  from ops.job_requirements
  where job_id = 'f2000000-0000-4000-8000-000000000001';
  if v_conflict is distinct from true then
    raise exception 'expected a conflict when the pencil no longer covers the stair climber';
  end if;
  if not exists (
    select 1 from core.notifications
    where user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
      and kind = 'requirements_conflict'
  ) then
    raise exception 'the rep was not notified about the pencil conflict';
  end if;
end
$$;
