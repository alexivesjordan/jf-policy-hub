-- Jordan Pulse release R2 (PR #51): rollback.sql   (TEMPLATE - do not run this file directly)
-- DESTRUCTIVE. Puts production back to the pre-R2 state (56 migrations, latest 20261120120000).
-- Fill it first: replace the marker line below with the output of 02-capture-rollback.sql, taken on
-- production before the apply. Keep the filled file outside the repository. Run the filled file as
-- ONE transaction:  psql -X -1 -v ON_ERROR_STOP=1 -f <filled file>   |   or paste it into the SQL Editor.
-- Unfilled, it stops at once ("STOP: captured section missing").
-- If the R2 app is deployed, do a Vercel Instant Rollback to the previous deployment FIRST.
-- Works after a partial apply. Refuses if no R2 migration is recorded or a newer migration exists. It:
--   1. restores the 11 replaced functions exactly as captured from production, with their grants
--   2. drops the 14 R2 functions
--   3. drops the 6 R2 tables (install_prep_tasks, install_prep_assignees, install_hq_photos,
--      vehicle_checks, vehicle_check_files, vehicle_flags): THEIR ROWS ARE LOST (prep tasks, HQ photo
--      links, vehicle checks, flags since release). Photo files (core.files, Storage) are kept.
--   4. drops ops.installs.started_at (Start times since release are lost)
--   5. restores Elite Cardio ops.sku_effort rows from the snapshot, only rows still on the R2 HQ
--      profile and not confirmed; rows edited since release are left and listed as "R2 REVIEW:"
--   6. deletes the four R2 schema_migrations rows
--   7. verifies md5s and grants equal the capture, R2 objects gone, 56 migrations; else nothing changes.

do $r2rbg$
declare v_n int; v_max text;
begin
  select count(*) into v_n from supabase_migrations.schema_migrations
  where version in ('20261121090000', '20261121090100', '20261121090200', '20261121090300');
  select max(version) into v_max from supabase_migrations.schema_migrations;
  if v_n = 0 then
    raise exception 'STOP: no R2 migration is recorded; there is nothing to roll back.';
  end if;
  if v_max > '20261121090300' then
    raise exception 'STOP: a migration newer than R2 is recorded (%). Do not roll R2 back underneath it; contact Balthazar.', v_max;
  end if;
  raise notice 'R2 ROLLBACK: % of 4 R2 migrations recorded; rolling back', v_n;
end
$r2rbg$;

-- @@R2_CAPTURED_PROD_SECTION@@

do $r2rbc$
begin
  if to_regclass('pg_temp.r2_expected_after_rollback') is null or to_regclass('pg_temp.r2_sku_snapshot') is null then
    raise exception 'STOP: captured section missing. Run the R2-rollback-PROD-<time>.sql file built by step 03, not the 99-rollback.sql template.';
  end if;
  if (select count(*) from r2_expected_after_rollback) <> 11 then
    raise exception 'STOP: captured section is incomplete (% of 11 functions)', (select count(*) from r2_expected_after_rollback);
  end if;
end
$r2rbc$;

-- 2. drop the 14 functions R2 added
drop function if exists public.install_access_email_context(uuid);
drop function if exists public.install_list_vehicle_flags();
drop function if exists public.install_prepare_quote_email(uuid, text);
drop function if exists public.install_resolve_vehicle_flag(uuid);
drop function if exists public.install_save_hq_photo(uuid, text, uuid);
drop function if exists public.install_start_job(uuid);
drop function if exists public.install_submit_vehicle_check(uuid, jsonb);
drop function if exists ops.assert_visit_started(uuid, text);
drop function if exists ops.cancel_install_prep(uuid);
drop function if exists ops.elite_cardio_item(text, text);
drop function if exists ops.install_day_open(date, date, date);
drop function if exists ops.install_default_van(uuid);
drop function if exists ops.prep_due_on(date, integer);
drop function if exists ops.sync_install_prep(uuid);

-- 3. drop the 6 R2 tables
drop table if exists ops.vehicle_flags;
drop table if exists ops.vehicle_check_files;
drop table if exists ops.vehicle_checks;
drop table if exists ops.install_hq_photos;
drop table if exists ops.install_prep_assignees;
drop table if exists ops.install_prep_tasks;

-- 4. drop the Start column
alter table ops.installs drop column if exists started_at;

-- 5. Elite Cardio ops.sku_effort rows
do $r2rbs$
declare v_restored int; v_kept text;
begin
  select string_agg(s.sku, ', ' order by s.sku) into v_kept
  from ops.sku_effort s join r2_sku_snapshot b on b.sku = s.sku
  where b.status <> 'confirmed'
    and not (s.status <> 'confirmed' and s.needs_assembly is true and s.crew = 2 and s.build_minutes = 120
             and s.build_location = 'hq' and s.hq_build_minutes = 120 and s.hq_build_crew = 2 and s.site_position_minutes = 45);
  update ops.sku_effort s
  set needs_assembly = b.needs_assembly, crew = b.crew, build_minutes = b.build_minutes,
      build_location = b.build_location, hq_build_minutes = b.hq_build_minutes, hq_build_crew = b.hq_build_crew,
      site_position_minutes = b.site_position_minutes, suggestion_rule = b.suggestion_rule, updated_at = b.updated_at
  from r2_sku_snapshot b
  where b.sku = s.sku and b.status <> 'confirmed'
    and s.status <> 'confirmed' and s.needs_assembly is true and s.crew = 2 and s.build_minutes = 120
    and s.build_location = 'hq' and s.hq_build_minutes = 120 and s.hq_build_crew = 2 and s.site_position_minutes = 45;
  get diagnostics v_restored = row_count;
  raise notice 'R2 ROLLBACK: % Elite Cardio sku_effort row(s) restored from the snapshot', v_restored;
  if v_kept is not null then
    raise warning 'R2 REVIEW: Elite Cardio rows edited after the release were left as they are: %', v_kept;
  end if;
end
$r2rbs$;

-- 6. migration history
delete from supabase_migrations.schema_migrations
where version in ('20261121090000', '20261121090100', '20261121090200', '20261121090300');

-- 7. verify (any failure undoes the whole file)
do $r2rbv$
declare r record; v_md5 text; v_acl text; v_count int; v_max text;
begin
  for r in select * from r2_expected_after_rollback loop
    select md5(pg_get_functiondef(p.oid)), (select coalesce(string_agg(split_part(x::text,'/',1), ',' order by split_part(x::text,'/',1)), '') from unnest(coalesce(p.proacl, acldefault('f', p.proowner))) x where split_part(x::text,'=',1) <> pg_get_userbyid(p.proowner)::text) into v_md5, v_acl
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where (n.nspname||'.'||p.proname||'('||oidvectortypes(p.proargtypes)||')') = r.sig;
    if v_md5 is distinct from r.md5 then
      raise exception 'STOP: % was not restored to the captured production version (md5 %, expected %)', r.sig, v_md5, r.md5;
    end if;
    if v_acl is distinct from r.acl then
      raise exception 'STOP: % grants are % after rollback (expected %)', r.sig, v_acl, r.acl;
    end if;
  end loop;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname || '.' || p.proname = any (array['ops.assert_visit_started','ops.cancel_install_prep','ops.elite_cardio_item','ops.install_day_open','ops.install_default_van','ops.prep_due_on','ops.sync_install_prep','public.install_access_email_context','public.install_list_vehicle_flags','public.install_prepare_quote_email','public.install_resolve_vehicle_flag','public.install_save_hq_photo','public.install_start_job','public.install_submit_vehicle_check'])) then
    raise exception 'STOP: an R2 function is still present';
  end if;
  if exists (select 1 from unnest(array['ops.install_prep_tasks','ops.install_prep_assignees','ops.install_hq_photos','ops.vehicle_checks','ops.vehicle_check_files','ops.vehicle_flags']) t where to_regclass(t) is not null) then
    raise exception 'STOP: an R2 table is still present';
  end if;
  if exists (select 1 from pg_attribute where attrelid = 'ops.installs'::regclass and attname = 'started_at' and not attisdropped) then
    raise exception 'STOP: ops.installs.started_at is still present';
  end if;
  select count(*), max(version) into v_count, v_max from supabase_migrations.schema_migrations;
  if v_count <> 56 or v_max is distinct from '20261120120000' then
    raise exception 'STOP: expected 56 migrations ending 20261120120000 after rollback, found % ending %', v_count, v_max;
  end if;
  raise notice 'R2 ROLLED BACK';
end
$r2rbv$;

select 'R2 ROLLED BACK' as result, count(*) as migrations, max(version) as latest,
  (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','ops','core') and p.prokind in ('f','p') and not (n.nspname||'.'||p.proname = any(array['ops.assert_visit_started','ops.cancel_install_prep','ops.elite_cardio_item','ops.finish_install_cancel','ops.install_day_open','ops.install_default_van','ops.prep_due_on','ops.sync_install_prep','ops.visit_payload','public.install_access_email_context','public.install_book','public.install_list_vehicle_flags','public.install_move','public.install_prepare_quote_email','public.install_resolve_vehicle_flag','public.install_save_hq_photo','public.install_save_visit_risk','public.install_save_visit_sheet','public.install_start_job','public.install_submit_vehicle_check','public.install_visit_photos','public.install_visit_upload_gate','public.ops_pulse','public.orbit_list_tasks','public.subcontractor_award']))) as other_functions_count,
  (select md5(string_agg(pg_get_functiondef(p.oid), '' order by (n.nspname||'.'||p.proname||'('||oidvectortypes(p.proargtypes)||')'))) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','ops','core') and p.prokind in ('f','p') and not (n.nspname||'.'||p.proname = any(array['ops.assert_visit_started','ops.cancel_install_prep','ops.elite_cardio_item','ops.finish_install_cancel','ops.install_day_open','ops.install_default_van','ops.prep_due_on','ops.sync_install_prep','ops.visit_payload','public.install_access_email_context','public.install_book','public.install_list_vehicle_flags','public.install_move','public.install_prepare_quote_email','public.install_resolve_vehicle_flag','public.install_save_hq_photo','public.install_save_visit_risk','public.install_save_visit_sheet','public.install_start_job','public.install_submit_vehicle_check','public.install_visit_photos','public.install_visit_upload_gate','public.ops_pulse','public.orbit_list_tasks','public.subcontractor_award']))) as other_functions_md5
from supabase_migrations.schema_migrations;
