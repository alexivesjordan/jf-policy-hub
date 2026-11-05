-- Checks for the office-shell RPCs and FIXTURE jobs. Runs after the M0 harness.

do $$
declare
  v_jobs jsonb;
  v_job jsonb;
  v_terms jsonb;
  v_pricing jsonb;
  v_fixture integer;
begin
  select count(*) into v_fixture
  from ops.install_jobs
  where cin7_number like 'FIXTURE-%';
  if v_fixture <> 4 then
    raise exception 'FAIL: expected 4 fixture jobs, got %', v_fixture;
  end if;

  if exists (select 1 from ops.quote_versions q join ops.install_jobs j on j.id = q.job_id where j.cin7_number like 'FIXTURE-%') then
    raise exception 'FAIL: fixture jobs should have no quote versions';
  end if;

  if exists (select 1 from ops.terms_versions where is_live) then
    raise exception 'FAIL: a terms version was marked live';
  end if;
end
$$;

update auth.sessions_test
set uid = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', role = 'authenticated';

do $$
declare
  v_jobs jsonb;
  v_job jsonb;
  v_context jsonb;
begin
  v_context := public.orbit_office_context();
  if (v_context->>'is_owner')::boolean is not true or (v_context->>'has_module')::boolean is not true then
    raise exception 'FAIL: Alex office context %', v_context;
  end if;

  v_jobs := public.orbit_list_jobs();
  if (
    select count(*)
    from jsonb_array_elements(v_jobs) as item
    where item->>'cin7_number' like 'FIXTURE-%'
  ) <> 4 then
    raise exception 'FAIL: owner job list fixtures %', v_jobs;
  end if;

  v_job := public.orbit_get_job('f2000000-0000-4000-8000-000000000002');
  if v_job->>'status' <> 'awaiting_access'
     or v_job->>'fixture' <> 'true'
     or v_job->'quote_versions' <> '[]'::jsonb
     or v_job->'customer'->>'name' not like 'FIXTURE%'
  then
    raise exception 'FAIL: fixture job detail %', v_job;
  end if;
end
$$;

update auth.sessions_test
set uid = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', role = 'authenticated';

do $$
declare
  v_jobs jsonb;
begin
  v_jobs := public.orbit_list_jobs();
  if exists (
    select 1 from jsonb_array_elements(v_jobs) as item
    where item->>'cin7_number' like 'FIXTURE-%'
  ) then
    raise exception 'FAIL: sales can see fixture jobs';
  end if;

  if public.orbit_get_job('f2000000-0000-4000-8000-000000000001') is not null then
    raise exception 'FAIL: sales can open a fixture job';
  end if;

  begin
    perform public.orbit_save_pricing(0.40, 0.40, 0.50, 0.80, null, null, 0.3333, 50000, 0.5, 'sales should not');
    raise exception 'FAIL: sales saved pricing';
  exception
    when others then
      if sqlerrm not like '%Only the owner%' then
        raise exception 'FAIL: unexpected sales pricing error: %', sqlerrm;
      end if;
  end;
end
$$;

update auth.sessions_test
set uid = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', role = 'authenticated';

do $$
declare
  v_pricing jsonb;
  v_terms jsonb;
  v_lines jsonb;
begin
  v_pricing := public.orbit_save_pricing(0.41, 0.40, 0.50, 0.80, null, null, 0.3333, 50000, 0.5, 'Office shell check');
  if (v_pricing->'pricing_settings'->>'version')::int <> 2 then
    raise exception 'FAIL: pricing version %', v_pricing->'pricing_settings';
  end if;
  if v_pricing->'pricing_settings'->>'min_job_charge' is not null
     or v_pricing->'pricing_settings'->>'margin_floor_pct' is not null
  then
    raise exception 'FAIL: unset pricing values were filled';
  end if;
  if (v_pricing->'pricing_settings'->>'markup_independent')::numeric <> 0.41 then
    raise exception 'FAIL: markup was not appended';
  end if;

  begin
    update ops.pricing_settings set markup_trade = 0.10;
    raise exception 'FAIL: pricing row was updated in place';
  exception
    when others then
      if sqlerrm not like '%immutable%' then
        raise exception 'FAIL: unexpected pricing mutation error: %', sqlerrm;
      end if;
  end;

  v_terms := public.orbit_read_terms();
  v_lines := v_terms->'charges_grid'->'lines';
  v_lines := jsonb_set(v_lines, '{0,rate}', '31'::jsonb);
  v_terms := public.orbit_save_terms(v_lines, 'Office shell grid check');
  if v_terms->>'is_live' <> 'false' then
    raise exception 'FAIL: edited terms were marked live';
  end if;
  if (v_terms->'charges_grid'->'lines'->0->>'rate')::numeric <> 31 then
    raise exception 'FAIL: charges rate was not appended';
  end if;
  if (select count(*) from ops.terms_versions) < 2 then
    raise exception 'FAIL: terms edit replaced the original row';
  end if;
end
$$;

select 'office shell checks passed' as result;
