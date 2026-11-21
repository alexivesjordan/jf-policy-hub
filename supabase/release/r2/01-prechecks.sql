-- Jordan Pulse release R2 (PR #51): 01-prechecks.sql
-- Read-only. Changes nothing. Run on production BEFORE anything else.
--   psql: psql -X -v ON_ERROR_STOP=1 -f 01-prechecks.sql   |   or paste into the Supabase SQL Editor.
-- Stops with "ERROR: STOP: ..." unless production is in the tested pre-R2 state:
--   * 56 migrations, latest 20261120120000; none of 20261121090000/090100/090200/090300 recorded
--   * each of the 11 functions R2 replaces exists exactly once
--   * none of the 14 new functions, 6 new tables or ops.installs.started_at exists yet
-- Prints "R2 REVIEW: ..." warnings (not a stop) if a replaced function's definition or grants differ
-- from TEST. Do not apply after a REVIEW warning without checking it: the apply verifies grants.
-- The summary previews the backfill. Release only when on_site_today_needing_start = 0.
-- Record other_functions_md5 / other_functions_count: 03-postchecks.sql must print the same values.

do $r2pre$
declare
  c_ref constant jsonb := '{"ops.finish_install_cancel(uuid, text)": {"md5": "722d9172b93d57de6d527207dfa3c95a", "acl": ""}, "ops.visit_payload(ops.installs)": {"md5": "64a36e36e6a7b67aede98ec524e48fbd", "acl": ""}, "public.install_book(uuid, date, text)": {"md5": "c98be7eafc9ba7f3f655d441cf3e80a5", "acl": "authenticated=X,service_role=X"}, "public.install_move(uuid, date)": {"md5": "f490b9f00854c739de8059f9b2032ae6", "acl": "authenticated=X,service_role=X"}, "public.install_save_visit_risk(uuid, jsonb, uuid[], text)": {"md5": "c75b90bfc6a84dc6a20d7183e8c72ac1", "acl": "authenticated=X,service_role=X"}, "public.install_save_visit_sheet(uuid, jsonb, text)": {"md5": "42b98b30356f5fecc922d2de1faeab4f", "acl": "authenticated=X,service_role=X"}, "public.install_visit_photos(uuid)": {"md5": "177b5856987ad53c6f4946226dd39e8c", "acl": "authenticated=X,service_role=X"}, "public.install_visit_upload_gate(uuid, text, text)": {"md5": "dd993c989191470c72924561f7b3820b", "acl": "authenticated=X,service_role=X"}, "public.ops_pulse()": {"md5": "b981be19df42b590c4d803abcb754142", "acl": "authenticated=X,service_role=X"}, "public.orbit_list_tasks()": {"md5": "f54c0e8bd6af6fa5091a3f68292eb826", "acl": "authenticated=X,service_role=X"}, "public.subcontractor_award(uuid, uuid, numeric, date)": {"md5": "78793750a4c2185faefc8bf9f50e3d4c", "acl": "authenticated=X,service_role=X"}}'::jsonb;
  v_count int; v_max text; v_n int; v_sig text; v_md5 text; v_acl text; v_review int := 0;
  r record;
begin
  select count(*), max(version) into v_count, v_max from supabase_migrations.schema_migrations;
  if v_count <> 56 or v_max is distinct from '20261120120000' then
    raise exception 'STOP: expected 56 migrations ending 20261120120000, found % ending %', v_count, v_max;
  end if;
  select count(*) into v_n from supabase_migrations.schema_migrations
  where version in ('20261121090000', '20261121090100', '20261121090200', '20261121090300');
  if v_n <> 0 then
    raise exception 'STOP: % of the R2 migrations are already recorded. Do not apply again.', v_n;
  end if;

  for v_sig in select jsonb_object_keys(c_ref) loop
    select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname || '.' || p.proname = split_part(v_sig, '(', 1);
    if v_n <> 1 then
      raise exception 'STOP: expected exactly 1 function %, found %', split_part(v_sig, '(', 1), v_n;
    end if;
    select md5(pg_get_functiondef(p.oid)), (select coalesce(string_agg(split_part(x::text,'/',1), ',' order by split_part(x::text,'/',1)), '') from unnest(coalesce(p.proacl, acldefault('f', p.proowner))) x where split_part(x::text,'=',1) <> pg_get_userbyid(p.proowner)::text) into v_md5, v_acl
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where (n.nspname||'.'||p.proname||'('||oidvectortypes(p.proargtypes)||')') = v_sig;
    if v_md5 is null then
      raise exception 'STOP: % has unexpected argument types (expected exactly %)', split_part(v_sig, '(', 1), v_sig;
    end if;
    if v_md5 <> c_ref->v_sig->>'md5' then
      v_review := v_review + 1;
      raise warning 'R2 REVIEW: % definition differs from the TEST reference (md5 %, TEST %)', v_sig, v_md5, c_ref->v_sig->>'md5';
    end if;
    if v_acl <> c_ref->v_sig->>'acl' then
      v_review := v_review + 1;
      raise warning 'R2 REVIEW: % grants differ from the TEST reference (%, TEST %)', v_sig, v_acl, c_ref->v_sig->>'acl';
    end if;
  end loop;

  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname || '.' || p.proname = any (array['ops.assert_visit_started','ops.cancel_install_prep','ops.elite_cardio_item','ops.install_day_open','ops.install_default_van','ops.prep_due_on','ops.sync_install_prep','public.install_access_email_context','public.install_list_vehicle_flags','public.install_prepare_quote_email','public.install_resolve_vehicle_flag','public.install_save_hq_photo','public.install_start_job','public.install_submit_vehicle_check']);
  if v_n <> 0 then
    raise exception 'STOP: % of the functions R2 adds already exist', v_n;
  end if;
  if exists (select 1 from unnest(array['ops.install_prep_tasks','ops.install_prep_assignees','ops.install_hq_photos','ops.vehicle_checks','ops.vehicle_check_files','ops.vehicle_flags']) t where to_regclass(t) is not null) then
    raise exception 'STOP: one of the R2 tables already exists';
  end if;
  if exists (select 1 from pg_attribute where attrelid = 'ops.installs'::regclass and attname = 'started_at' and not attisdropped) then
    raise exception 'STOP: ops.installs.started_at already exists';
  end if;

  if v_review = 0 then
    raise notice 'R2 PRE-CHECKS PASSED (all 11 replaced functions match the TEST reference)';
  else
    raise notice 'R2 PRE-CHECKS PASSED WITH % REVIEW ITEM(S)', v_review;
  end if;
end
$r2pre$;

with live as (
  select i.*, (jsonb_typeof(i.hq_build->'lines') = 'array' and jsonb_array_length(i.hq_build->'lines') > 0) as has_hq
  from ops.installs i
  where i.status in ('booked', 'scheduled', 'in_progress')
),
plan as (
  select l.*,
    case when l.has_hq and l.start_on is not null then (select d::date from generate_series(l.start_on - 7, l.start_on - 1, interval '1 day') d where extract(isodow from d) < 6 order by d desc offset 1 limit 1) end as hq_due,
    case when l.start_on is not null then (case when extract(isodow from l.start_on) < 6 then l.start_on else (select max(d)::date from generate_series(l.start_on - 3, l.start_on - 1, interval '1 day') d where extract(isodow from d) < 6) end) end as vc_due
  from live l
),
today as (select (timezone('Europe/London', now()))::date as d)
select k as check_name, v as value
from (values
  (1, 'result', 'R2 PRE-CHECKS PASSED'),
  (2, 'checked_at_utc', to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') || ' UTC'),
  (3, 'server_version', current_setting('server_version')),
  (4, 'migrations_count', (select count(*)::text from supabase_migrations.schema_migrations)),
  (5, 'migrations_max', (select max(version) from supabase_migrations.schema_migrations)),
  (6, 'other_functions_count', (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','ops','core') and p.prokind in ('f','p') and not (n.nspname||'.'||p.proname = any(array['ops.assert_visit_started','ops.cancel_install_prep','ops.elite_cardio_item','ops.finish_install_cancel','ops.install_day_open','ops.install_default_van','ops.prep_due_on','ops.sync_install_prep','ops.visit_payload','public.install_access_email_context','public.install_book','public.install_list_vehicle_flags','public.install_move','public.install_prepare_quote_email','public.install_resolve_vehicle_flag','public.install_save_hq_photo','public.install_save_visit_risk','public.install_save_visit_sheet','public.install_start_job','public.install_submit_vehicle_check','public.install_visit_photos','public.install_visit_upload_gate','public.ops_pulse','public.orbit_list_tasks','public.subcontractor_award'])))),
  (7, 'other_functions_md5', (select md5(string_agg(pg_get_functiondef(p.oid), '' order by (n.nspname||'.'||p.proname||'('||oidvectortypes(p.proargtypes)||')'))) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','ops','core') and p.prokind in ('f','p') and not (n.nspname||'.'||p.proname = any(array['ops.assert_visit_started','ops.cancel_install_prep','ops.elite_cardio_item','ops.finish_install_cancel','ops.install_day_open','ops.install_default_van','ops.prep_due_on','ops.sync_install_prep','ops.visit_payload','public.install_access_email_context','public.install_book','public.install_list_vehicle_flags','public.install_move','public.install_prepare_quote_email','public.install_resolve_vehicle_flag','public.install_save_hq_photo','public.install_save_visit_risk','public.install_save_visit_sheet','public.install_start_job','public.install_submit_vehicle_check','public.install_visit_photos','public.install_visit_upload_gate','public.ops_pulse','public.orbit_list_tasks','public.subcontractor_award'])))),
  (8, 'london_today', (select d::text || ' (' || trim(to_char(d, 'Day')) || ')' from today)),
  (9, 'installs_booked_scheduled_in_progress', (select count(*)::text from live)),
  (10, 'backfill_hq_build_tasks_to_create', (select count(*)::text from plan where has_hq)),
  (11, 'backfill_vehicle_checks_to_create', (select count(*)::text from plan)),
  (12, 'backfill_hq_tasks_overdue_at_once', (select count(*)::text from plan where hq_due is not null and ((hq_due)::timestamp + time '17:00') at time zone 'Europe/London' < now())),
  (13, 'backfill_vehicle_checks_overdue_at_once', (select count(*)::text from plan where vc_due is not null and ((vc_due)::timestamp + time '17:00') at time zone 'Europe/London' < now())),
  (14, 'backfill_tasks_with_no_due_date', (select count(*)::text from plan where start_on is null)),
  (15, 'started_at_backfill_rows', (select count(*)::text from ops.installs i where i.status in ('in_progress', 'completed') or exists (select 1 from ops.risk_assessments r where r.install_id = i.id) or exists (select 1 from ops.visit_sheets s where s.install_id = i.id))),
  (16, 'on_site_today_needing_start', (select count(*)::text from live l, today t where l.start_on <= t.d and l.end_on >= t.d and l.status <> 'in_progress' and not exists (select 1 from ops.risk_assessments r where r.install_id = l.id) and not exists (select 1 from ops.visit_sheets s where s.install_id = l.id))),
  (17, 'elite_cardio_sku_rows_to_update', (select count(*)::text from ops.sku_effort where (coalesce(sku, '') ~* '^JF-EC-' or coalesce(product_name, '') ~* 'elite[[:space:]]+cardio') and status <> 'confirmed')),
  (18, 'elite_cardio_sku_rows_confirmed_untouched', (select count(*)::text from ops.sku_effort where (coalesce(sku, '') ~* '^JF-EC-' or coalesce(product_name, '') ~* 'elite[[:space:]]+cardio') and status = 'confirmed'))
) as t(n, k, v)
order by n;
