-- Jordan Pulse release R2 (PR #51): 03-postchecks.sql
-- Read-only. Changes nothing. Run straight after the four R2 migrations are applied.
--   psql: psql -X -v ON_ERROR_STOP=1 -f 03-postchecks.sql   |   or paste into the Supabase SQL Editor.
-- Stops with "ERROR: STOP: ..." unless:
--   * 60 migrations, latest 20261121090300, with the four R2 rows named as in the repo
--   * all 25 R2 functions are exactly the tested versions (md5 + grants, owner excluded), none
--     executable by anon or PUBLIC
--   * the 6 new tables have RLS on, no anon/authenticated privileges, service_role access; both indexes exist
--   * ops.installs.started_at is timestamptz and set only where the backfill rule allows
-- other_functions_md5 / other_functions_count must equal the 01-prechecks.sql values.

do $r2post$
declare
  c_exp constant jsonb := '{"ops.assert_visit_started(uuid, text)": {"md5": "19f0c8965efff27c7b21ea837251fc33", "acl": ""}, "ops.cancel_install_prep(uuid)": {"md5": "897ec43f56a0251a480e2026ffab5d5c", "acl": ""}, "ops.elite_cardio_item(text, text)": {"md5": "9cd992d2dd19cadcb07f4d02bc7d0263", "acl": ""}, "ops.finish_install_cancel(uuid, text)": {"md5": "5e52220f1869aa75fee53d8c1d4fb132", "acl": ""}, "ops.install_day_open(date, date, date)": {"md5": "1d046a97d10124c321c48395fb07f3b2", "acl": ""}, "ops.install_default_van(uuid)": {"md5": "7b49708c0672345c533348d2bcc61c1c", "acl": ""}, "ops.prep_due_on(date, integer)": {"md5": "58aed2590fe2b2e3d76acf56b1a2909b", "acl": ""}, "ops.sync_install_prep(uuid)": {"md5": "d7fb0833d53366aaeb807282a68e2f6e", "acl": ""}, "ops.visit_payload(ops.installs)": {"md5": "fdff41e349f9fdf98646ed3a861010a2", "acl": ""}, "public.install_access_email_context(uuid)": {"md5": "5ede319b2bc255a4790940b561cacc8a", "acl": "service_role=X"}, "public.install_book(uuid, date, text)": {"md5": "cb9925695fb15eea786fc5a6c06fbe2b", "acl": "authenticated=X,service_role=X"}, "public.install_list_vehicle_flags()": {"md5": "7c8fcdec63448f35bd340b370e56be40", "acl": "authenticated=X,service_role=X"}, "public.install_move(uuid, date)": {"md5": "146c905b965a36c67ffec93d339d4bf8", "acl": "authenticated=X,service_role=X"}, "public.install_prepare_quote_email(uuid, text)": {"md5": "e994662633f012976c383d4445b5de4d", "acl": "authenticated=X,service_role=X"}, "public.install_resolve_vehicle_flag(uuid)": {"md5": "2882f5af643f99e500a35c9646be19e5", "acl": "authenticated=X,service_role=X"}, "public.install_save_hq_photo(uuid, text, uuid)": {"md5": "dc7da20083c759027232a06b353d3def", "acl": "authenticated=X,service_role=X"}, "public.install_save_visit_risk(uuid, jsonb, uuid[], text)": {"md5": "d46a408e435e4b5f3e0c39c460c1d807", "acl": "authenticated=X,service_role=X"}, "public.install_save_visit_sheet(uuid, jsonb, text)": {"md5": "eb95885af7c46c36ea63d18df825b354", "acl": "authenticated=X,service_role=X"}, "public.install_start_job(uuid)": {"md5": "360088202ffe555c6b8f37d537c2511b", "acl": "authenticated=X,service_role=X"}, "public.install_submit_vehicle_check(uuid, jsonb)": {"md5": "512c4134bca708ad78f68c9d9210601b", "acl": "authenticated=X,service_role=X"}, "public.install_visit_photos(uuid)": {"md5": "edbac7dcb07fbcbb1f55494c91168d23", "acl": "authenticated=X,service_role=X"}, "public.install_visit_upload_gate(uuid, text, text)": {"md5": "8c7b051f260b9269604adb979ba0d6eb", "acl": "authenticated=X,service_role=X"}, "public.ops_pulse()": {"md5": "2c1378fa43a1c83dd9aad69e08f10678", "acl": "authenticated=X,service_role=X"}, "public.orbit_list_tasks()": {"md5": "a9aa7d63eff331c90adce8dcc4d41217", "acl": "authenticated=X,service_role=X"}, "public.subcontractor_award(uuid, uuid, numeric, date)": {"md5": "700e9894378ff303707571ffd31be9c6", "acl": "authenticated=X,service_role=X"}}'::jsonb;
  v_count int; v_max text; v_sig text; v_md5 text; v_acl text; v_t text; v_n int;
begin
  select count(*), max(version) into v_count, v_max from supabase_migrations.schema_migrations;
  if v_count <> 60 or v_max is distinct from '20261121090300' then
    raise exception 'STOP: expected 60 migrations ending 20261121090300, found % ending %', v_count, v_max;
  end if;
  select count(*) into v_n from supabase_migrations.schema_migrations
  where (version, name) in (('20261121090000', 'quote_contact_email'), ('20261121090100', 'elite_cardio_hq'),
                            ('20261121090200', 'install_prep_and_briefing'), ('20261121090300', 'prep_briefing_fixes'));
  if v_n <> 4 then
    raise exception 'STOP: the four R2 migration rows are not all present with the expected names (found %)', v_n;
  end if;

  for v_sig in select jsonb_object_keys(c_exp) loop
    select md5(pg_get_functiondef(p.oid)), (select coalesce(string_agg(split_part(x::text,'/',1), ',' order by split_part(x::text,'/',1)), '') from unnest(coalesce(p.proacl, acldefault('f', p.proowner))) x where split_part(x::text,'=',1) <> pg_get_userbyid(p.proowner)::text) into v_md5, v_acl
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where (n.nspname||'.'||p.proname||'('||oidvectortypes(p.proargtypes)||')') = v_sig;
    if v_md5 is distinct from c_exp->v_sig->>'md5' then
      raise exception 'STOP: % is not the tested version (md5 %, expected %)', v_sig, v_md5, c_exp->v_sig->>'md5';
    end if;
    if v_acl is distinct from c_exp->v_sig->>'acl' then
      raise exception 'STOP: % grants are % (expected %)', v_sig, v_acl, c_exp->v_sig->>'acl';
    end if;
    if exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      cross join lateral unnest(coalesce(p.proacl, acldefault('f', p.proowner))) x
      where (n.nspname||'.'||p.proname||'('||oidvectortypes(p.proargtypes)||')') = v_sig and split_part(x::text, '=', 1) in ('', 'anon')
    ) then
      raise exception 'STOP: % is executable by anon or PUBLIC', v_sig;
    end if;
  end loop;
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname || '.' || p.proname = any (array['ops.assert_visit_started','ops.cancel_install_prep','ops.elite_cardio_item','ops.finish_install_cancel','ops.install_day_open','ops.install_default_van','ops.prep_due_on','ops.sync_install_prep','ops.visit_payload','public.install_access_email_context','public.install_book','public.install_list_vehicle_flags','public.install_move','public.install_prepare_quote_email','public.install_resolve_vehicle_flag','public.install_save_hq_photo','public.install_save_visit_risk','public.install_save_visit_sheet','public.install_start_job','public.install_submit_vehicle_check','public.install_visit_photos','public.install_visit_upload_gate','public.ops_pulse','public.orbit_list_tasks','public.subcontractor_award']);
  if v_n <> 25 then
    raise exception 'STOP: expected 25 R2 functions (one overload each), found %', v_n;
  end if;

  foreach v_t in array array['ops.install_prep_tasks','ops.install_prep_assignees','ops.install_hq_photos','ops.vehicle_checks','ops.vehicle_check_files','ops.vehicle_flags'] loop
    if to_regclass(v_t) is null then raise exception 'STOP: table % is missing', v_t; end if;
    if not (select relrowsecurity from pg_class where oid = v_t::regclass) then
      raise exception 'STOP: row level security is off on %', v_t;
    end if;
    if has_table_privilege('anon', v_t, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       or has_table_privilege('authenticated', v_t, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then
      raise exception 'STOP: anon or authenticated has privileges on %', v_t;
    end if;
    if not has_table_privilege('service_role', v_t, 'SELECT,INSERT,UPDATE,DELETE') then
      raise exception 'STOP: service_role lacks privileges on %', v_t;
    end if;
  end loop;
  if (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'ops' and c.relkind = 'i' and c.relname = any (array['install_prep_tasks_due_idx','vehicle_flags_open_idx'])) <> 2 then
    raise exception 'STOP: one of the R2 indexes is missing';
  end if;
  if (select format_type(atttypid, atttypmod) from pg_attribute
      where attrelid = 'ops.installs'::regclass and attname = 'started_at' and not attisdropped) is distinct from 'timestamp with time zone' then
    raise exception 'STOP: ops.installs.started_at is missing or has the wrong type';
  end if;
  raise notice 'R2 POST-CHECKS PASSED';
end
$r2post$;

select k as check_name, v as value
from (values
  (1, 'result', 'R2 POST-CHECKS PASSED'),
  (2, 'checked_at_utc', to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') || ' UTC'),
  (3, 'migrations_count', (select count(*)::text from supabase_migrations.schema_migrations)),
  (4, 'migrations_max', (select max(version) from supabase_migrations.schema_migrations)),
  (5, 'other_functions_count', (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','ops','core') and p.prokind in ('f','p') and not (n.nspname||'.'||p.proname = any(array['ops.assert_visit_started','ops.cancel_install_prep','ops.elite_cardio_item','ops.finish_install_cancel','ops.install_day_open','ops.install_default_van','ops.prep_due_on','ops.sync_install_prep','ops.visit_payload','public.install_access_email_context','public.install_book','public.install_list_vehicle_flags','public.install_move','public.install_prepare_quote_email','public.install_resolve_vehicle_flag','public.install_save_hq_photo','public.install_save_visit_risk','public.install_save_visit_sheet','public.install_start_job','public.install_submit_vehicle_check','public.install_visit_photos','public.install_visit_upload_gate','public.ops_pulse','public.orbit_list_tasks','public.subcontractor_award'])))),
  (6, 'other_functions_md5', (select md5(string_agg(pg_get_functiondef(p.oid), '' order by (n.nspname||'.'||p.proname||'('||oidvectortypes(p.proargtypes)||')'))) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','ops','core') and p.prokind in ('f','p') and not (n.nspname||'.'||p.proname = any(array['ops.assert_visit_started','ops.cancel_install_prep','ops.elite_cardio_item','ops.finish_install_cancel','ops.install_day_open','ops.install_default_van','ops.prep_due_on','ops.sync_install_prep','ops.visit_payload','public.install_access_email_context','public.install_book','public.install_list_vehicle_flags','public.install_move','public.install_prepare_quote_email','public.install_resolve_vehicle_flag','public.install_save_hq_photo','public.install_save_visit_risk','public.install_save_visit_sheet','public.install_start_job','public.install_submit_vehicle_check','public.install_visit_photos','public.install_visit_upload_gate','public.ops_pulse','public.orbit_list_tasks','public.subcontractor_award'])))),
  (7, 'prep_tasks_hq_build', (select count(*)::text from ops.install_prep_tasks where kind = 'hq_build')),
  (8, 'prep_tasks_vehicle_check', (select count(*)::text from ops.install_prep_tasks where kind = 'vehicle_check')),
  (9, 'prep_tasks_open_overdue', (select count(*)::text from ops.install_prep_tasks where status = 'open' and due_on is not null and (due_on::timestamp + time '17:00') at time zone 'Europe/London' < now())),
  (10, 'started_at_set', (select count(*)::text from ops.installs where started_at is not null)),
  (11, 'started_at_set_outside_backfill_rule', (select count(*)::text from ops.installs i where i.started_at is not null and not (i.status in ('in_progress', 'completed') or exists (select 1 from ops.risk_assessments r where r.install_id = i.id) or exists (select 1 from ops.visit_sheets s where s.install_id = i.id)))),
  (12, 'elite_cardio_rows_on_hq_profile', (select count(*)::text from ops.sku_effort where ops.elite_cardio_item(sku, product_name) and status <> 'confirmed' and build_location = 'hq')),
  (13, 'elite_cardio_rows_not_on_hq_profile_unconfirmed', (select count(*)::text from ops.sku_effort where ops.elite_cardio_item(sku, product_name) and status <> 'confirmed' and build_location is distinct from 'hq')),
  (14, 'vehicle_flags_open', (select count(*)::text from ops.vehicle_flags where status = 'open'))
) as t(n, k, v)
order by n;
