-- Jordan Pulse release R2 (PR #51): 02-capture-rollback.sql
-- Read-only. Changes nothing. Run on production AFTER 01-prechecks.sql and BEFORE applying the migrations.
-- Captures FROM PRODUCTION what rollback.sql needs to put production back exactly: the 11 replaced
-- function definitions, their grants, an md5 + grants table the rollback verifies against, and a
-- snapshot of the Elite Cardio ops.sku_effort rows that 20261121090100 updates.
-- Its single result cell IS that SQL section. Save it, then make the filled rollback file by replacing
-- the line "-- @@R2_CAPTURED_PROD_SECTION@@" in a copy of rollback.sql with it, e.g.
--   psql -X -q -At -v ON_ERROR_STOP=1 -f 02-capture-rollback.sql -o captured.sql
-- Keep the filled rollback file OUTSIDE the repository (it contains production definitions and data).
-- Warns "R2 REVIEW: ..." if production differs from the TEST reference (md5s and grants are inline below);
-- production's own text is captured either way. Stops if any R2 migration is already recorded.

do $r2cap$
declare
  c_ref constant jsonb := '{"ops.finish_install_cancel(uuid, text)": {"md5": "722d9172b93d57de6d527207dfa3c95a", "acl": ""}, "ops.visit_payload(ops.installs)": {"md5": "64a36e36e6a7b67aede98ec524e48fbd", "acl": ""}, "public.install_book(uuid, date, text)": {"md5": "c98be7eafc9ba7f3f655d441cf3e80a5", "acl": "authenticated=X,service_role=X"}, "public.install_move(uuid, date)": {"md5": "f490b9f00854c739de8059f9b2032ae6", "acl": "authenticated=X,service_role=X"}, "public.install_save_visit_risk(uuid, jsonb, uuid[], text)": {"md5": "c75b90bfc6a84dc6a20d7183e8c72ac1", "acl": "authenticated=X,service_role=X"}, "public.install_save_visit_sheet(uuid, jsonb, text)": {"md5": "42b98b30356f5fecc922d2de1faeab4f", "acl": "authenticated=X,service_role=X"}, "public.install_visit_photos(uuid)": {"md5": "177b5856987ad53c6f4946226dd39e8c", "acl": "authenticated=X,service_role=X"}, "public.install_visit_upload_gate(uuid, text, text)": {"md5": "dd993c989191470c72924561f7b3820b", "acl": "authenticated=X,service_role=X"}, "public.ops_pulse()": {"md5": "b981be19df42b590c4d803abcb754142", "acl": "authenticated=X,service_role=X"}, "public.orbit_list_tasks()": {"md5": "f54c0e8bd6af6fa5091a3f68292eb826", "acl": "authenticated=X,service_role=X"}, "public.subcontractor_award(uuid, uuid, numeric, date)": {"md5": "78793750a4c2185faefc8bf9f50e3d4c", "acl": "authenticated=X,service_role=X"}}'::jsonb;
  v_count int; v_max text; v_n int; v_sig text; v_md5 text; v_acl text; v_review int := 0;
begin
  select count(*), max(version) into v_count, v_max from supabase_migrations.schema_migrations;
  if v_count <> 56 or v_max is distinct from '20261120120000' then
    raise exception 'STOP: capture must run on the pre-R2 state (56 migrations ending 20261120120000); found % ending %', v_count, v_max;
  end if;
  select count(*) into v_n from supabase_migrations.schema_migrations
  where version in ('20261121090000', '20261121090100', '20261121090200', '20261121090300');
  if v_n <> 0 then
    raise exception 'STOP: R2 migrations already recorded; the capture must be taken before the apply.';
  end if;
  for v_sig in select jsonb_object_keys(c_ref) loop
    select md5(pg_get_functiondef(p.oid)), (select coalesce(string_agg(split_part(x::text,'/',1), ',' order by split_part(x::text,'/',1)), '') from unnest(coalesce(p.proacl, acldefault('f', p.proowner))) x where split_part(x::text,'=',1) <> pg_get_userbyid(p.proowner)::text) into v_md5, v_acl
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where (n.nspname||'.'||p.proname||'('||oidvectortypes(p.proargtypes)||')') = v_sig;
    if v_md5 is null then
      raise exception 'STOP: % not found on this database', v_sig;
    end if;
    if v_md5 <> c_ref->v_sig->>'md5' then
      v_review := v_review + 1;
      raise warning 'R2 REVIEW: production % differs from the TEST reference (md5 %, TEST %). The production text is what is captured.', v_sig, v_md5, c_ref->v_sig->>'md5';
    end if;
    if v_acl <> c_ref->v_sig->>'acl' then
      v_review := v_review + 1;
      raise warning 'R2 REVIEW: production % grants differ from the TEST reference (%, TEST %). The production grants are what is captured.', v_sig, v_acl, c_ref->v_sig->>'acl';
    end if;
  end loop;
  raise notice 'R2 CAPTURE: 11 functions, % Elite Cardio sku_effort rows, % difference(s) from the TEST reference',
    (select count(*) from ops.sku_effort s where (coalesce(s.sku, '') ~* '^JF-EC-' or coalesce(s.product_name, '') ~* 'elite[[:space:]]+cardio')), v_review;
end
$r2cap$;

with f as (
  select p.oid, (n.nspname||'.'||p.proname||'('||oidvectortypes(p.proargtypes)||')') as sig, md5(pg_get_functiondef(p.oid)) as md5, (select coalesce(string_agg(split_part(x::text,'/',1), ',' order by split_part(x::text,'/',1)), '') from unnest(coalesce(p.proacl, acldefault('f', p.proowner))) x where split_part(x::text,'=',1) <> pg_get_userbyid(p.proowner)::text) as acl
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where (n.nspname||'.'||p.proname||'('||oidvectortypes(p.proargtypes)||')') = any (array['ops.finish_install_cancel(uuid, text)','ops.visit_payload(ops.installs)','public.install_book(uuid, date, text)','public.install_move(uuid, date)','public.install_save_visit_risk(uuid, jsonb, uuid[], text)','public.install_save_visit_sheet(uuid, jsonb, text)','public.install_visit_photos(uuid)','public.install_visit_upload_gate(uuid, text, text)','public.ops_pulse()','public.orbit_list_tasks()','public.subcontractor_award(uuid, uuid, numeric, date)'])
),
g as (
  select f.sig, split_part(split_part(x::text, '/', 1), '=', 1) as grantee
  from f join pg_proc p on p.oid = f.oid
  cross join lateral unnest(coalesce(p.proacl, acldefault('f', p.proowner))) x
  where split_part(x::text, '=', 1) <> pg_get_userbyid(p.proowner)::text
),
parts(ord, sub, txt) as (
  select 0, '', '-- ===== R2 CAPTURED PRODUCTION SECTION (generated by 03-capture-rollback.sql; do not edit) =====' || chr(10) ||
    '-- captured_at_utc: ' || to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') || chr(10) ||
    '-- database: ' || current_database() || ', server ' || current_setting('server_version') || ', migrations ' ||
    (select count(*) from supabase_migrations.schema_migrations) || ' ending ' || (select max(version) from supabase_migrations.schema_migrations)
  union all select 1, '', 'create temp table r2_expected_after_rollback (sig text primary key, md5 text not null, acl text not null) on commit drop;'
  union all select 2, f.sig, format('insert into r2_expected_after_rollback values (%L, %L, %L);', f.sig, f.md5, f.acl) from f
  union all select 3, '', '-- ----- the 11 replaced functions, exactly as production had them -----'
  union all select 4, f.sig, pg_get_functiondef(f.oid) || ';' from f
  union all select 5, f.sig, format('revoke all on function %s from public, anon, authenticated, service_role;', f.sig) from f
  union all select 6, g.sig || g.grantee, format('grant execute on function %s to %s;', g.sig, case when g.grantee = '' then 'public' else quote_ident(g.grantee) end) from g
  union all select 7, '', '-- ----- ops.sku_effort Elite Cardio rows before 20261121090100 -----'
  union all select 8, '', format('create temp table r2_sku_snapshot on commit drop as select * from jsonb_populate_recordset(null::ops.sku_effort, %L::jsonb);',
      coalesce((select jsonb_agg(to_jsonb(s) order by s.sku) from ops.sku_effort s where (coalesce(s.sku, '') ~* '^JF-EC-' or coalesce(s.product_name, '') ~* 'elite[[:space:]]+cardio')), '[]'::jsonb)::text)
  union all select 9, '', '-- ===== R2 CAPTURED SECTION END ====='
)
select string_agg(txt, chr(10) order by ord, sub) as captured_section from parts;
