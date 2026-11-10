-- Null owner_rep_id must not let a sales editor pencil the job.
-- Run on the throwaway database after the harness (auth.sessions_test + Sam Sales).
-- Restores the job owner and Sam's access when it finishes.

do $$
declare
  v_job uuid := 'f2000000-0000-4000-8000-000000000001';
  v_sales uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  v_owner uuid;
  v_role text;
  v_mode text;
  v_active boolean;
  v_granted boolean;
  v_allowed boolean;
begin
  if to_regclass('auth.sessions_test') is null then
    raise exception 'auth.sessions_test is missing. Run scripts/sql/orbit-m0-harness-pre.sql first.';
  end if;
  if not exists (select 1 from public.profiles where id = v_sales) then
    raise exception 'Sam Sales is missing. Run scripts/sql/orbit-m0-harness-post.sql first.';
  end if;

  select owner_rep_id into v_owner from ops.install_jobs where id = v_job;
  select workspace_role, access_mode, is_active, access_granted
    into v_role, v_mode, v_active, v_granted
  from public.profiles where id = v_sales;

  update public.profiles
  set workspace_role = 'member',
      access_mode = 'custom',
      is_active = true,
      access_granted = true
  where id = v_sales;

  insert into public.module_access (profile_id, module_id, enabled, access_level)
  values
    (v_sales, 'sales', true, 'edit'),
    (v_sales, 'operations', false, 'none')
  on conflict (profile_id, module_id) do update
    set enabled = excluded.enabled,
        access_level = excluded.access_level;

  update ops.install_jobs set owner_rep_id = null where id = v_job;
  update auth.sessions_test set uid = v_sales, role = 'authenticated' where id = 1;

  v_allowed := public.can_pencil_job(null);
  if v_allowed is null or v_allowed then
    raise exception 'can_pencil_job(null) for a sales editor was %', v_allowed;
  end if;

  begin
    perform public.orbit_pencil_range(
      v_job,
      date '2026-11-16',
      false,
      array[
        'f3000000-0000-4000-8000-000000000001',
        'f3000000-0000-4000-8000-000000000002',
        'f3000000-0000-4000-8000-000000000005'
      ]::uuid[]
    );
    raise exception 'FAIL: a sales editor pencilled a job with a null owner';
  exception
    when others then
      if sqlerrm not like '%cannot pencil%' then
        raise;
      end if;
  end;

  update ops.install_jobs set owner_rep_id = v_owner where id = v_job;
  update public.profiles
  set workspace_role = v_role,
      access_mode = v_mode,
      is_active = v_active,
      access_granted = v_granted
  where id = v_sales;
end
$$;
