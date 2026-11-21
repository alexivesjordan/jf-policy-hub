-- Jordan Pulse release R2 (PR #51): 04-smoke-test.sql
-- Functional smoke test on the live database. NOTHING IS KEPT: one transaction, never committed.
--   psql: psql -X -v ON_ERROR_STOP=1 -f 04-smoke-test.sql   |   or paste into the Supabase SQL Editor.
-- EXPECTED ENDING, always an ERROR:
--   R2 SMOKE TEST COMPLETE - ROLLED BACK ON PURPOSE. passed=..., failed=..., skipped=...
-- That error undoes everything (test quotes ZZ-R2-SMOKE-1..6, installs, tasks, checks, flags, test
-- vans ZZ99 R2S / ZZ99 R2X, test crew, temporary parking of real crew/van resources). psql exits 3.
-- PASS = failed=0. Skips are explained in the results. No email, no Cin7 call.
-- Holds row locks on ops.resources for a few seconds.
-- Users are looked up, never hard-coded (only ids printed): admin alex.ives@jordanfitness.com,
-- an active field engineer, a sales-only user (else sales checks SKIP), an ops user (else the
-- engineer is marked office staff inside the transaction). 74 checks mirroring the TEST cases.

begin;

create or replace function pg_temp.run(p_uid uuid, p_role text, p_sql text) returns jsonb language plpgsql as $f$
declare v text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub',p_uid,'role',p_role)::text, true);
  execute format('set local role %I', p_role);
  execute 'select ('||p_sql||')::text' into v;
  reset role;
  return jsonb_build_object('ok',true,'val',v);
exception when others then
  reset role;
  return jsonb_build_object('ok',false,'err',sqlerrm);
end $f$;

do $r2smoke$
declare
  r jsonb := '[]'::jsonb;
  c_admin_email constant text := 'alex.ives@jordanfitness.com';
  admin uuid; eng uuid; staff uuid; opsu uuid; booker uuid; lewis uuid; v_other_inst uuid; v_helper uuid;
  p record; res jsonb; n_pass int := 0; n_fail int := 0; n_skip int := 0; v_status text;
  pre_started jsonb; n_deact int;
  c_sales_only constant text[] := array['M2','H5','V7','F3','F5','F6','F8','N1','T1','S6'];
  today date := timezone('Europe/London', now())::date;
  wkday boolean;
  d0 date; vres uuid; vtest uuid; voff uuid; ares uuid;
  q1 uuid; q2 uuid; q3 uuid; q4 uuid; q5 uuid; q6 uuid;
  i1 uuid; i2 uuid; i3 uuid; i4 uuid; i5 uuid;
  hq uuid; vc uuid; hq2 uuid; vc2 uuid; k1 text; k2 text;
  f_bad uuid := gen_random_uuid(); f_foreign uuid; f_vd uuid; f_hq1 uuid; f_hq2 uuid; f_dmg uuid; f_dmg_foreign uuid;
  f_es uuid; f_cs uuid; f_pdf uuid; tok text := md5('a')||md5('b');
  x jsonb; y jsonb; n int; base jsonb; payload jsonb; ans jsonb := '{"accessClear":true,"floorSuitable":true,"powerSafe":true,"handlingPlanned":true,"peopleBriefed":true}';
  sheet jsonb; flag uuid; ec_before jsonb; ec_after jsonb; sdue text;
begin
  -- ---------- pick real users (nothing hard-coded; only ids are printed) ----------
  for p in select id from public.profiles where lower(email) = c_admin_email and is_active order by id loop
    perform set_config('request.jwt.claims', json_build_object('sub', p.id, 'role', 'authenticated')::text, true);
    if public.workspace_is_admin() then admin := p.id; exit; end if;
  end loop;
  for p in select id from public.profiles where is_active order by id loop
    perform set_config('request.jwt.claims', json_build_object('sub', p.id, 'role', 'authenticated')::text, true);
    if ops.is_field_engineer() and not public.workspace_is_admin() then eng := p.id; exit; end if;
  end loop;
  for p in select id from public.profiles where is_active and access_granted order by id loop
    perform set_config('request.jwt.claims', json_build_object('sub', p.id, 'role', 'authenticated')::text, true);
    if public.workspace_can('sales', 'edit') and not public.workspace_can('operations', 'view')
       and not public.workspace_is_admin() and not ops.is_field_engineer() then staff := p.id; exit; end if;
  end loop;
  for p in select id from public.profiles where is_active and access_granted order by id loop
    perform set_config('request.jwt.claims', json_build_object('sub', p.id, 'role', 'authenticated')::text, true);
    if public.workspace_can('operations', 'view') and not public.workspace_is_admin() and not ops.is_field_engineer() then opsu := p.id; exit; end if;
  end loop;
  perform set_config('request.jwt.claims', '', true);
  booker := coalesce(staff, admin);
  r := r || jsonb_build_object('t','setup','status','INFO','detail',format('admin=%s engineer=%s sales=%s ops=%s booker=%s',
    coalesce(admin::text,'NONE'), coalesce(eng::text,'NONE'), coalesce(staff::text,'NONE'),
    coalesce(opsu::text,'NONE (N3 uses a temporary office-staff mark on the engineer)'), coalesce(booker::text,'NONE')));
  if admin is null or eng is null then
    r := r || jsonb_build_object('t','ALL TESTS','status','SKIP','detail','no active admin (' || c_admin_email || ') or no active field engineer found; nothing was tested');
    raise notice '% | %  (%)', rpad('SKIP', 6), 'ALL TESTS', 'admin or engineer not found';
    raise exception 'R2 SMOKE TEST COMPLETE - ROLLED BACK ON PURPOSE. passed=0, failed=0, skipped=1 RESULTS:%', r::text;
  end if;
  select coalesce(jsonb_object_agg(id::text, started_at), '{}'::jsonb) into pre_started from ops.installs where started_at is not null;

  wkday := extract(isodow from today) < 6;
  d0 := today + (8 - extract(isodow from today)::int);   -- next Monday
  r := r || jsonb_build_object('t','context','status','INFO','detail',format('today=%s weekday=%s first_test_monday=%s', today, wkday, d0));

  -- fixtures (postgres)
  -- Inside this rolled-back transaction only: park every real crew and van resource and add test ones,
  -- so the bookings below are allocated to the discovered engineer and a test van.
  update ops.resources set status='inactive' where status='active' and resource_type in ('installer','helper','van');
  get diagnostics n_deact = row_count;
  insert into ops.resources(resource_type,name,status,has_licence,profile_id) values ('installer','ZZ R2 SMOKE engineer','active',true,eng) returning id into lewis;
  insert into ops.resources(resource_type,name,status,has_licence) values ('installer','ZZ R2 SMOKE installer 2','active',true) returning id into v_other_inst;
  insert into ops.resources(resource_type,name,status,has_licence) values ('helper','ZZ R2 SMOKE helper','active',true) returning id into v_helper;
  insert into ops.resources(resource_type,name,status) values ('van','ZZ99 R2S','active') returning id into vres;
  insert into ops.vans(registration,name,active) values ('ZZ99 R2S','R2 smoke test van',true) returning id into vtest;
  insert into ops.vans(registration,name,active) values ('ZZ99 R2X','Off van',false) returning id into voff;
  base := jsonb_build_object('totalDays',1,'requirements',jsonb_build_object('installers',2,'vanSize','small','vanCount',1,'licensedDrivers',0),
    'customerName','Test Co','contactName','Pat','contactEmail','c@example.com','goodsNet',1000,'installPrice',200,'siteAddress','1 Test St',
    'lines',jsonb_build_array(jsonb_build_object('sku','JF-EC-TM1','description','Jordan Elite Cardio Treadmill','qty',1),jsonb_build_object('sku','JF-EC-BK1','description','Jordan Elite Cardio Bike','qty',2)),
    'hqBuild',jsonb_build_object('lines',jsonb_build_array(jsonb_build_object('productName','Jordan Elite Cardio Treadmill','qty',1,'sku','JF-EC-TM1'),jsonb_build_object('productName','Jordan Elite Cardio Bike','qty',2))));
  insert into ops.install_quotes(created_by,order_number,payload) values (booker,'ZZ-R2-SMOKE-1',base) returning id into q1;
  insert into ops.install_quotes(created_by,order_number,payload) values (booker,'ZZ-R2-SMOKE-2',base - 'hqBuild') returning id into q2;
  insert into ops.install_quotes(created_by,order_number,payload) values (booker,'ZZ-R2-SMOKE-3',base) returning id into q3;
  insert into ops.install_quotes(created_by,order_number,payload) values (booker,'ZZ-R2-SMOKE-4',base - 'hqBuild') returning id into q4;
  insert into ops.install_quotes(created_by,order_number,payload) values (booker,'ZZ-R2-SMOKE-5',base - 'hqBuild') returning id into q5;
  insert into ops.install_quotes(created_by,order_number,payload) values (booker,'ZZ-R2-SMOKE-6',base - 'contactEmail') returning id into q6;

  -- B1 booking (staff/sales) creates 1 HQ + 1 vehicle check, due dates skip weekend
  x := pg_temp.run(booker,'authenticated',format('public.install_book(%L,%L,%L)',q1,d0,'none'));
  select install_id into i1 from ops.install_quotes where id=q1;
  select id, due_on::text into hq, sdue from ops.install_prep_tasks where install_id=i1 and kind='hq_build';
  select id into vc from ops.install_prep_tasks where install_id=i1 and kind='vehicle_check';
  r := r || jsonb_build_object('t','B1 book creates 1 HQ + 1 vehicle check','ok', x->>'ok'='true'
     and (select count(*) from ops.install_prep_tasks where install_id=i1 and kind='hq_build')=1
     and (select count(*) from ops.install_prep_tasks where install_id=i1 and kind='vehicle_check')=1, 'book',x->'err');
  r := r || jsonb_build_object('t','B2 HQ due = 2 working days before Monday start (prev Thursday); van check due on start','ok',
     (select due_on from ops.install_prep_tasks where id=hq)=d0-4 and (select due_on from ops.install_prep_tasks where id=vc)=d0,
     'hq_due',(select due_on from ops.install_prep_tasks where id=hq),'vc_due',(select due_on from ops.install_prep_tasks where id=vc));
  select items into y from ops.install_prep_tasks where id=hq;
  k1 := y->0->>'key'; k2 := y->1->>'key';
  r := r || jsonb_build_object('t','B3 HQ items = 2 lines, SKU filled from order lines','ok', jsonb_array_length(y)=2 and y->1->>'sku'='JF-EC-BK1','items',y);
  r := r || jsonb_build_object('t','B4 assignees = assigned installer (eng) on both tasks','ok',
     (select array_agg(distinct profile_id) from ops.install_prep_assignees where task_id in (hq,vc))=array[eng]
     and (select count(*) from ops.install_prep_assignees where task_id in (hq,vc))=2);
  -- B5 rebook idempotent
  x := pg_temp.run(booker,'authenticated',format('public.install_book(%L,%L,%L)',q1,d0,'none'));
  r := r || jsonb_build_object('t','B5 re-running booking is idempotent','ok', x->>'ok'='true'
     and (select count(*) from ops.install_prep_tasks where install_id=i1)=2
     and (select id from ops.install_prep_tasks where install_id=i1 and kind='hq_build')=hq
     and (select count(*) from ops.install_prep_assignees where task_id in (hq,vc))=2,'err',x->'err');
  -- B6 no HQ lines -> no HQ task
  x := pg_temp.run(booker,'authenticated',format('public.install_book(%L,%L,%L)',q2,d0+7,'none'));
  select install_id into i2 from ops.install_quotes where id=q2;
  r := r || jsonb_build_object('t','B6 no HQ lines -> 0 HQ tasks, 1 vehicle check','ok', x->>'ok'='true'
     and (select count(*) filter (where kind='hq_build') = 0 and count(*) filter (where kind='vehicle_check')=1 from ops.install_prep_tasks where install_id=i2),'err',x->'err');
  -- B7 engineer cannot book
  x := pg_temp.run(eng,'authenticated',format('public.install_book(%L,%L,%L)',q3,d0+14,'none'));
  r := r || jsonb_build_object('t','B7 field engineer cannot book','ok', x->>'ok'='false' and x->>'err' like '%cannot book%','err',x->'err');
  -- M1 move to Tuesday -> HQ due previous Friday, van due Tuesday
  x := pg_temp.run(admin,'authenticated',format('public.install_move(%L,%L)',i1,d0+1));
  r := r || jsonb_build_object('t','M1 install_move updates due dates (Tue start -> HQ due prev Fri)','ok', x->>'ok'='true'
     and (select due_on from ops.install_prep_tasks where id=hq)=d0-3 and (select due_on from ops.install_prep_tasks where id=vc)=d0+1,
     'hq_due',(select due_on from ops.install_prep_tasks where id=hq),'err',x->'err');
  x := pg_temp.run(staff,'authenticated',format('public.install_move(%L,%L)',i1,d0+2));
  r := r || jsonb_build_object('t','M2 sales staff cannot move','ok', x->>'ok'='false','err',x->'err');
  -- C1 crew change replaces assignees (on i2)
  update ops.resources set status='inactive' where id=lewis;
  insert into ops.resources(resource_type,name,status,has_licence,profile_id) values ('installer','AA51 Admin','active',true,admin) returning id into ares;
  x := pg_temp.run(admin,'authenticated',format('public.install_move(%L,%L)',i2,d0+8));
  r := r || jsonb_build_object('t','C1 crew change replaces assignees','ok', x->>'ok'='true'
     and (select array_agg(profile_id) from ops.install_prep_assignees a join ops.install_prep_tasks t on t.id=a.task_id where t.install_id=i2)=array[admin],'err',x->'err');
  update ops.resources set status='active' where id=lewis;
  update ops.resources set status='inactive' where id=ares;
  -- X1 cancel (i3 with HQ)
  x := pg_temp.run(booker,'authenticated',format('public.install_book(%L,%L,%L)',q3,d0+14,'none'));
  select install_id into i3 from ops.install_quotes where id=q3;
  x := pg_temp.run(admin,'authenticated',format('public.install_cancel(%L,%L)',i3,'test cancel'));
  r := r || jsonb_build_object('t','X1 cancel cancels open HQ task and vehicle check','ok', x->>'ok'='true'
     and (select count(*) from ops.install_prep_tasks where install_id=i3 and status='cancelled')=2
     and (select count(*) from ops.install_prep_tasks where install_id=i3)=2,'err',x->'err');

  -- H: HQ photos
  insert into core.files(bucket,storage_path,entity_schema,entity_table,entity_id,kind,mime_type) values ('job-sheets','zz-r2-smoke/foreign.jpg','ops','installs',i2,'hq_photo','image/jpeg') returning id into f_foreign;
  insert into core.files(bucket,storage_path,entity_schema,entity_table,entity_id,kind,mime_type) values ('job-sheets','zz-r2-smoke/vd.jpg','ops','installs',i1,'vehicle_damage','image/jpeg') returning id into f_vd;
  insert into core.files(bucket,storage_path,entity_schema,entity_table,entity_id,kind,mime_type) values ('job-sheets','zz-r2-smoke/hq1.jpg','ops','installs',i1,'hq_photo','image/jpeg') returning id into f_hq1;
  insert into core.files(bucket,storage_path,entity_schema,entity_table,entity_id,kind,mime_type) values ('job-sheets','zz-r2-smoke/hq2.jpg','ops','installs',i1,'hq_photo','image/jpeg') returning id into f_hq2;
  x := pg_temp.run(eng,'authenticated',format('public.install_save_hq_photo(%L,%L,%L)',i1,k1,f_bad));
  r := r || jsonb_build_object('t','H1 invalid file id refused','ok', x->>'ok'='false' and x->>'err' like '%not on this job%','err',x->'err');
  x := pg_temp.run(eng,'authenticated',format('public.install_save_hq_photo(%L,%L,%L)',i1,k1,f_foreign));
  r := r || jsonb_build_object('t','H2 foreign (other install) file refused','ok', x->>'ok'='false' and x->>'err' like '%not on this job%','err',x->'err');
  x := pg_temp.run(eng,'authenticated',format('public.install_save_hq_photo(%L,%L,%L)',i1,k1,f_vd));
  r := r || jsonb_build_object('t','H3 wrong-kind file refused','ok', x->>'ok'='false','err',x->'err');
  x := pg_temp.run(eng,'authenticated',format('public.install_save_hq_photo(%L,%L,%L)',i1,'nokey',f_hq1));
  r := r || jsonb_build_object('t','H4 unknown item key refused','ok', x->>'ok'='false' and x->>'err' like '%not on this build%','err',x->'err');
  x := pg_temp.run(staff,'authenticated',format('public.install_save_hq_photo(%L,%L,%L)',i1,k1,f_hq1));
  r := r || jsonb_build_object('t','H5 unassigned sales staff refused','ok', x->>'ok'='false','err',x->'err');
  x := pg_temp.run(eng,'authenticated',format('public.install_save_hq_photo(%L,%L,%L)',i1,k1,f_hq1));
  r := r || jsonb_build_object('t','H6 one of two photos -> task stays open','ok', x->>'ok'='true' and x->>'val' like '%false%' and (select status from ops.install_prep_tasks where id=hq)='open','val',x->'val','err',x->'err');
  x := pg_temp.run(eng,'authenticated',format('public.install_save_hq_photo(%L,%L,%L)',i1,k1,f_hq1));
  r := r || jsonb_build_object('t','H7 same photo twice does not complete','ok', (select status from ops.install_prep_tasks where id=hq)='open' and (select count(*) from ops.install_hq_photos where task_id=hq)=1);
  x := pg_temp.run(eng,'authenticated',format('public.install_save_hq_photo(%L,%L,%L)',i1,k2,f_hq2));
  r := r || jsonb_build_object('t','H8 photo per line -> task done','ok', x->>'ok'='true' and (select status from ops.install_prep_tasks where id=hq)='done','err',x->'err');
  x := pg_temp.run(admin,'authenticated',format('public.install_move(%L,%L)',i1,d0+1));
  r := r || jsonb_build_object('t','H9 move after completion keeps HQ task done','ok', x->>'ok'='true' and (select status from ops.install_prep_tasks where id=hq)='done','err',x->'err');

  -- V: vehicle check
  insert into core.files(bucket,storage_path,entity_schema,entity_table,entity_id,kind,mime_type) values ('job-sheets','zz-r2-smoke/dmg.jpg','ops','installs',i1,'vehicle_damage','image/jpeg') returning id into f_dmg;
  insert into core.files(bucket,storage_path,entity_schema,entity_table,entity_id,kind,mime_type) values ('job-sheets','zz-r2-smoke/dmg2.jpg','ops','installs',i2,'vehicle_damage','image/jpeg') returning id into f_dmg_foreign;
  payload := jsonb_build_object('driverId',eng,'vanId',vtest,'lights',true,'indicators',true,'mirrors',true,'brakes',true,'fueled',true,'noWarningLights',true,'tyrePressure',35,'treadDepth',4,'newDamage',false,'fitToDrive',true,'confirmed',true);
  r := r || jsonb_build_object('t','V0 default van resolves from reserved van resource','ok', ops.install_default_van(i1)=vtest);
  x := pg_temp.run(eng,'authenticated',format('public.install_submit_vehicle_check(%L,%L)',i1,payload || jsonb_build_object('driverId',admin)));
  r := r || jsonb_build_object('t','V1 driver not on job refused','ok', x->>'ok'='false' and x->>'err' like '%driver from this job%','err',x->'err');
  x := pg_temp.run(eng,'authenticated',format('public.install_submit_vehicle_check(%L,%L)',i1,payload || jsonb_build_object('vanId',voff)));
  r := r || jsonb_build_object('t','V2 inactive van refused','ok', x->>'ok'='false' and x->>'err' like '%vehicle from the fleet%','err',x->'err');
  x := pg_temp.run(eng,'authenticated',format('public.install_submit_vehicle_check(%L,%L)',i1,payload || '{"newDamage":true}'));
  r := r || jsonb_build_object('t','V3 damage without note refused','ok', x->>'ok'='false' and x->>'err' like '%Describe the new damage%','err',x->'err');
  x := pg_temp.run(eng,'authenticated',format('public.install_submit_vehicle_check(%L,%L)',i1,payload || '{"newDamage":true,"damageNote":"Scratch rear door"}'));
  r := r || jsonb_build_object('t','V4 damage without photo refused','ok', x->>'ok'='false' and x->>'err' like '%photo of the new damage%','err',x->'err');
  x := pg_temp.run(eng,'authenticated',format('public.install_submit_vehicle_check(%L,%L)',i1,payload || jsonb_build_object('newDamage',true,'damageNote','Scratch','damageFileIds',jsonb_build_array(f_dmg_foreign))));
  r := r || jsonb_build_object('t','V5 damage photo from another install refused','ok', x->>'ok'='false' and x->>'err' like '%not on this job%','err',x->'err');
  x := pg_temp.run(eng,'authenticated',format('public.install_submit_vehicle_check(%L,%L)',i1,payload || '{"confirmed":false}'));
  r := r || jsonb_build_object('t','V6 unconfirmed refused','ok', x->>'ok'='false','err',x->'err');
  x := pg_temp.run(staff,'authenticated',format('public.install_submit_vehicle_check(%L,%L)',i1,payload));
  r := r || jsonb_build_object('t','V7 unassigned sales staff refused','ok', x->>'ok'='false','err',x->'err');
  x := pg_temp.run(eng,'authenticated',format('public.install_submit_vehicle_check(%L,%L)',i1,payload || jsonb_build_object('newDamage',true,'damageNote','Scratch rear door','damageFileIds',jsonb_build_array(f_dmg),'fitToDrive',false)));
  r := r || jsonb_build_object('t','V8 damage+photo+unfit accepted -> 2 open flags, check task done','ok', x->>'ok'='true'
     and (select count(*) from ops.vehicle_flags where install_id=i1 and status='open')=2 and (select status from ops.install_prep_tasks where id=vc)='done','err',x->'err');
  x := pg_temp.run(eng,'authenticated',format('public.install_submit_vehicle_check(%L,%L)',i1,payload));
  r := r || jsonb_build_object('t','V9 second submission refused','ok', x->>'ok'='false' and x->>'err' like '%already in%','err',x->'err');
  x := pg_temp.run(admin,'authenticated','public.install_list_vehicle_flags()');
  y := (x->>'val')::jsonb;
  r := r || jsonb_build_object('t','F1 admin sees flags (damage flag carries the photo)','ok', x->>'ok'='true'
     and (select count(*) from jsonb_array_elements(y) e where e->>'installId'=i1::text)=2
     and (select jsonb_array_length(e->'photos') from jsonb_array_elements(y) e where e->>'installId'=i1::text and e->>'reason'='damage')=1,'err',x->'err');
  x := pg_temp.run(eng,'authenticated','public.install_list_vehicle_flags()');
  r := r || jsonb_build_object('t','F2 field engineer refused flags RPC','ok', x->>'ok'='false','err',x->'err');
  x := pg_temp.run(staff,'authenticated','public.install_list_vehicle_flags()');
  r := r || jsonb_build_object('t','F3 sales staff refused flags RPC','ok', x->>'ok'='false','err',x->'err');
  x := pg_temp.run(admin,'authenticated','public.ops_pulse()');
  r := r || jsonb_build_object('t','F4 ops_pulse warnings show the open flags to admin','ok', x->>'ok'='true'
     and (select count(*) from jsonb_array_elements((x->>'val')::jsonb->'warnings') w where w->>'label'='ZZ99 R2S' and (w->>'detail' like 'New damage%' or w->>'detail'='Not fit to drive'))=2,'err',x->'err');
  x := pg_temp.run(staff,'authenticated','public.ops_pulse()');
  r := r || jsonb_build_object('t','F5 sales staff refused ops_pulse','ok', x->>'ok'='false','err',x->'err');
  select id into flag from ops.vehicle_flags where install_id=i1 and reason='damage';
  x := pg_temp.run(eng,'authenticated',format('public.install_resolve_vehicle_flag(%L)',flag));
  y := pg_temp.run(staff,'authenticated',format('public.install_resolve_vehicle_flag(%L)',flag));
  r := r || jsonb_build_object('t','F6 engineer and sales cannot resolve a flag','ok', x->>'ok'='false' and y->>'ok'='false','e1',x->'err','e2',y->'err');
  x := pg_temp.run(admin,'authenticated',format('public.install_resolve_vehicle_flag(%L)',flag));
  r := r || jsonb_build_object('t','F7 admin resolves flag','ok', x->>'ok'='true' and (select status from ops.vehicle_flags where id=flag)='resolved','err',x->'err');
  insert into core.files(bucket,storage_path,entity_schema,entity_table,entity_id,kind,mime_type) values ('job-sheets','zz-r2-smoke/eq.jpg','ops','installs',i1,'equipment','image/jpeg');
  insert into core.files(bucket,storage_path,entity_schema,entity_table,entity_id,kind,mime_type) values ('job-sheets','zz-r2-smoke/cn.jpg','ops','installs',i1,'concern','image/jpeg');
  x := pg_temp.run(staff,'authenticated',format('public.install_visit_photos(%L)',i1));
  r := r || jsonb_build_object('t','F8 [changed] sales install_visit_photos returns NO vehicle_damage rows','ok', x->>'ok'='true'
     and not exists (select 1 from jsonb_array_elements((x->>'val')::jsonb) e where e->>'kind'='vehicle_damage'),'err',x->'err');
  r := r || jsonb_build_object('t','N1 sales still gets the other photo kinds (hq_photo x2, equipment, concern)','ok', x->>'ok'='true'
     and (select count(*) from jsonb_array_elements((x->>'val')::jsonb) e where e->>'kind'='hq_photo')=2
     and (select count(*) from jsonb_array_elements((x->>'val')::jsonb) e where e->>'kind'='equipment')=1
     and (select count(*) from jsonb_array_elements((x->>'val')::jsonb) e where e->>'kind'='concern')=1,
     'kinds',(select jsonb_agg(e->>'kind') from jsonb_array_elements((x->>'val')::jsonb) e));
  x := pg_temp.run(admin,'authenticated',format('public.install_visit_photos(%L)',i1));
  r := r || jsonb_build_object('t','N2 admin gets vehicle_damage rows (2 files on this job) plus all other kinds','ok', x->>'ok'='true'
     and (select count(*) from jsonb_array_elements((x->>'val')::jsonb) e where e->>'kind'='vehicle_damage')=2
     and (select count(*) from jsonb_array_elements((x->>'val')::jsonb) e)=6,'err',x->'err');
  if opsu is null then
    insert into ops.install_office_staff(profile_id,marked_by,marked_at) values (eng,admin,now());  -- temporary non-admin ops office user (rolled back)
    x := pg_temp.run(eng,'authenticated',format('public.install_visit_photos(%L)',i1));
  else
    x := pg_temp.run(opsu,'authenticated',format('public.install_visit_photos(%L)',i1));
  end if;
  r := r || jsonb_build_object('t','N3 non-admin operations-view user gets vehicle_damage rows','ok', x->>'ok'='true'
     and (select count(*) from jsonb_array_elements((x->>'val')::jsonb) e where e->>'kind'='vehicle_damage')=2,'err',x->'err');
  delete from ops.install_office_staff where profile_id=eng;
  x := pg_temp.run(eng,'authenticated',format('public.install_visit_photos(%L)',i1));
  r := r || jsonb_build_object('t','N4 field engineer still refused install_visit_photos','ok', x->>'ok'='false','err',x->'err');
  x := pg_temp.run(eng,'authenticated','public.orbit_list_tasks()');
  y := pg_temp.run(staff,'authenticated','public.orbit_list_tasks()');
  r := r || jsonb_build_object('t','T1 engineer sees own prep tasks; sales sees none','ok', x->>'ok'='true' and y->>'ok'='true'
     and (select count(*) from jsonb_array_elements((x->>'val')::jsonb) e where e->>'entity_id'=i1::text)=2
     and (select count(*) from jsonb_array_elements((y->>'val')::jsonb) e where e->>'entity_table'='installs' and e->>'module_id'='operations' and e->>'entity_id' in (i1::text,i2::text))=0);

  -- S: Start gate, risk and sheet
  r := r || jsonb_build_object('t','S1 install_day_open date check (Fri-Mon window)','ok',
     ops.install_day_open(d0-3,d0,d0-3) and not ops.install_day_open(d0-3,d0,d0-2) and not ops.install_day_open(d0-3,d0,d0-1)
     and ops.install_day_open(d0-3,d0,d0) and not ops.install_day_open(d0-3,d0,d0-4) and not ops.install_day_open(d0-3,d0,d0+1)
     and not ops.install_day_open(null,d0,d0));
  x := pg_temp.run(eng,'authenticated',format('public.install_save_visit_risk(%L,%L,%L,null)',i1,ans,'{}'));
  r := r || jsonb_build_object('t','S2 risk save refused before start','ok', x->>'ok'='false' and x->>'err' like '%Start this job%','err',x->'err');
  insert into core.files(bucket,storage_path,entity_schema,entity_table,entity_id,kind,mime_type) values ('job-sheets','zz-r2-smoke/es.png','ops','installs',i1,'engineer_signature','image/png') returning id into f_es;
  insert into core.files(bucket,storage_path,entity_schema,entity_table,entity_id,kind,mime_type) values ('job-sheets','zz-r2-smoke/cs.png','ops','installs',i1,'customer_signature','image/png') returning id into f_cs;
  insert into core.files(bucket,storage_path,entity_schema,entity_table,entity_id,kind,mime_type) values ('job-sheets','zz-r2-smoke/pack.pdf','ops','installs',i1,'visit_pack','application/pdf') returning id into f_pdf;
  sheet := jsonb_build_object('visitType','install','customerName','Pat','engineerName','Lewis','workCarriedOut','Installed','engineerSignatureFileId',f_es,'customerSignatureFileId',f_cs,'pdfFileId',f_pdf);
  x := pg_temp.run(eng,'authenticated',format('public.install_save_visit_sheet(%L,%L,null)',i1,sheet));
  r := r || jsonb_build_object('t','S3 job sheet save refused before start','ok', x->>'ok'='false' and x->>'err' like '%Start this job%','err',x->'err');
  x := pg_temp.run(eng,'authenticated',format('public.install_start_job(%L)',i1));
  r := r || jsonb_build_object('t','S4 start refused before install dates','ok', x->>'ok'='false' and x->>'err' like '%install day%','err',x->'err');
  update ops.installs set start_on=today-10, end_on=today-8 where id=i1;
  x := pg_temp.run(eng,'authenticated',format('public.install_start_job(%L)',i1));
  r := r || jsonb_build_object('t','S5 start refused after install dates','ok', x->>'ok'='false' and x->>'err' like '%install day%','err',x->'err');
  x := pg_temp.run(staff,'authenticated',format('public.install_start_job(%L)',i1));
  r := r || jsonb_build_object('t','S6 unassigned sales staff cannot start','ok', x->>'ok'='false','err',x->'err');
  if wkday then
    update ops.installs set start_on=today-2, end_on=today+3 where id=i1;   -- window around today
    r := r || jsonb_build_object('t','S7 visit_payload canStart true on install day','ok', (ops.visit_payload((select i from ops.installs i where id=i1))->>'canStart')::boolean);
    x := pg_temp.run(eng,'authenticated',format('public.install_start_job(%L)',i1));
    r := r || jsonb_build_object('t','S8 start allowed on install day (weekday) -> in_progress','ok', x->>'ok'='true'
       and (select started_at is not null and status='in_progress' from ops.installs where id=i1),'val',x->'val','err',x->'err');
  else
    update ops.installs set start_on=today-1, end_on=today+3 where id=i1;
    x := pg_temp.run(eng,'authenticated',format('public.install_start_job(%L)',i1));
    r := r || jsonb_build_object('t','S7w start refused on weekend inside install window','ok', x->>'ok'='false' and x->>'err' like '%install day%','err',x->'err');
    update ops.installs set started_at=now(), status='in_progress' where id=i1;  -- simulate start for the save tests
    r := r || jsonb_build_object('t','S8w weekday start covered by S1 date check','ok',true);
  end if;
  x := pg_temp.run(eng,'authenticated',format('public.install_start_job(%L)',i1));
  r := r || jsonb_build_object('t','S9 second start is a no-op returning same startedAt','ok', x->>'ok'='true' and (x->>'val')::jsonb->>'startedAt' is not null,'err',x->'err');
  x := pg_temp.run(eng,'authenticated',format('public.install_save_visit_risk(%L,%L,%L,null)',i1,ans,'{}'));
  r := r || jsonb_build_object('t','S10 risk save allowed after start','ok', x->>'ok'='true','err',x->'err');
  x := pg_temp.run(eng,'authenticated',format('public.install_save_visit_sheet(%L,%L,null)',i1,sheet));
  r := r || jsonb_build_object('t','S11 job sheet save allowed after start','ok', x->>'ok'='true','err',x->'err');

  -- weekend fixture through the real RPC (window covering a weekend, today simulated through date check) + gate on cancelled
  -- Token path exempt (i4 not started)
  x := pg_temp.run(booker,'authenticated',format('public.install_book(%L,%L,%L)',q4,d0+21,'none'));
  select install_id into i4 from ops.install_quotes where id=q4;
  insert into core.token_links(purpose,token_hash,entity_schema,entity_table,entity_id) values ('subcontractor_job',decode(tok,'hex'),'ops','installs',i4);
  y := pg_temp.run(eng,'authenticated',format('public.install_save_visit_risk(%L,%L,%L,null)',i4,ans,'{}'));
  x := pg_temp.run(null,'service_role',format('public.install_save_visit_risk(%L,%L,%L,%L)',i4,ans,'{}',tok));
  r := r || jsonb_build_object('t','S12 subcontractor token path exempt from Start gate (engineer path on same job still gated)','ok', x->>'ok'='true' and y->>'ok'='false' and y->>'err' like '%Start this job%','tok',x->'err','eng',y->'err');
  y := pg_temp.run(eng,'authenticated',format('public.install_save_visit_risk(%L,%L,%L,null)',i4,ans,'{}'));
  r := r || jsonb_build_object('t','S13 [changed] after a token-path risk save, in-house engineer is still refused before Start','ok', y->>'ok'='false' and y->>'err' like '%Start this job%'
     and (select started_at is null from ops.installs where id=i4)
     and not (ops.visit_payload((select i from ops.installs i where id=i4))->>'started')::boolean,'err',y->'err');
  -- token-path job sheet
  insert into core.files(bucket,storage_path,entity_schema,entity_table,entity_id,kind,mime_type) values ('job-sheets','zz-r2-smoke/es4.png','ops','installs',i4,'engineer_signature','image/png') returning id into f_es;
  insert into core.files(bucket,storage_path,entity_schema,entity_table,entity_id,kind,mime_type) values ('job-sheets','zz-r2-smoke/cs4.png','ops','installs',i4,'customer_signature','image/png') returning id into f_cs;
  insert into core.files(bucket,storage_path,entity_schema,entity_table,entity_id,kind,mime_type) values ('job-sheets','zz-r2-smoke/pack4.pdf','ops','installs',i4,'visit_pack','application/pdf') returning id into f_pdf;
  x := pg_temp.run(null,'service_role',format('public.install_save_visit_sheet(%L,%L,%L)',i4,jsonb_build_object('visitType','install','customerName','Pat','engineerName','Sub','workCarriedOut','Installed','engineerSignatureFileId',f_es,'customerSignatureFileId',f_cs,'pdfFileId',f_pdf),tok));
  r := r || jsonb_build_object('t','N5 subcontractor token-path job sheet save succeeds without Start','ok', x->>'ok'='true'
     and (select token_link_id is not null from ops.visit_sheets where install_id=i4),'err',x->'err');
  r := r || jsonb_build_object('t','N6 token-path sheet does not count as started (assert_visit_started raises for in-house path)','ok',
     not (ops.visit_payload((select i from ops.installs i where id=i4))->>'started')::boolean
     and (select started_at is null from ops.installs where id=i4));
  begin
    perform ops.assert_visit_started(i4, null);
    r := r || jsonb_build_object('t','N6b assert_visit_started(in-house) after token risk+sheet','ok',false);
  exception when others then
    r := r || jsonb_build_object('t','N6b assert_visit_started(in-house) after token risk+sheet raises Start','ok', sqlerrm like '%Start this job%','err',sqlerrm);
  end;
  -- Existing (legacy) install with a risk assessment but no started_at still works
  x := pg_temp.run(booker,'authenticated',format('public.install_book(%L,%L,%L)',q5,d0+28,'none'));
  select install_id into i5 from ops.install_quotes where id=q5;
  insert into ops.risk_assessments(install_id,answers,completed_by) values (i5,ans,eng);
  r := r || jsonb_build_object('t','L1 [changed] legacy in-house risk assessment (completed_by set) shows started, canStart false','ok',
     (ops.visit_payload((select i from ops.installs i where id=i5))->>'started')::boolean and not (ops.visit_payload((select i from ops.installs i where id=i5))->>'canStart')::boolean);
  x := pg_temp.run(eng,'authenticated',format('public.install_save_visit_risk(%L,%L,%L,null)',i5,ans,'{}'));
  r := r || jsonb_build_object('t','L2 legacy in-house risk: save still works and stamps started_at','ok', x->>'ok'='true' and (select started_at is not null from ops.installs where id=i5),'err',x->'err');
  r := r || jsonb_build_object('t','L3 migration backfill: completed install has started_at','ok',
     (select bool_and(started_at is not null) from ops.installs where status in ('in_progress','completed') and id not in (i1,i2,i3,i4,i5)));
  r := r || jsonb_build_object('t','N7 pre-existing started_at values untouched by booking/moving/starting test jobs','ok',
     pre_started = (select coalesce(jsonb_object_agg(id::text, started_at), '{}'::jsonb) from ops.installs where id::text in (select jsonb_object_keys(pre_started))),
     'n', (select count(*) from jsonb_object_keys(pre_started)));
  begin
    select to_jsonb(started_at) into y from ops.installs where id=i1;
    perform ops.assert_visit_started(i1, null);
    r := r || jsonb_build_object('t','N8 already-started job: assert_visit_started passes and leaves started_at unchanged','ok', (select to_jsonb(started_at) from ops.installs where id=i1)=y);
  exception when others then
    r := r || jsonb_build_object('t','N8 already-started job: assert_visit_started passes and leaves started_at unchanged','ok',false,'err',sqlerrm);
  end;
  x := pg_temp.run(eng,'authenticated',format('public.install_visit_upload_gate(%L,null,%L)',i1,'hq_photo'));
  y := pg_temp.run(null,'service_role',format('public.install_visit_upload_gate(%L,%L,%L)',i4,tok,'vehicle_damage'));
  r := r || jsonb_build_object('t','U1 upload gate: assigned engineer may upload hq_photo; token link may not upload vehicle_damage','ok', x->>'ok'='true' and y->>'ok'='false','e1',x->'err','e2',y->'err');

  -- E: Elite Cardio
  r := r || jsonb_build_object('t','E1 elite_cardio_item matches SKU prefix and name','ok', ops.elite_cardio_item('JF-EC-TM1',null) and ops.elite_cardio_item('x','Jordan Elite  Cardio Bike') and not ops.elite_cardio_item('JF-ECX','Elite rower'));
  r := r || jsonb_build_object('t','E2 all non-confirmed Elite Cardio rows now HQ profile','ok', not exists (select 1 from ops.sku_effort where ops.elite_cardio_item(sku,product_name) and status<>'confirmed' and (build_location<>'hq' or hq_build_minutes<>120 or hq_build_crew<>2)),
     'n',(select count(*) from ops.sku_effort where ops.elite_cardio_item(sku,product_name)));
  if not exists (select 1 from ops.sku_effort where ops.elite_cardio_item(sku,product_name)) then
    r := r || jsonb_build_object('t','E3 migration update leaves a confirmed row untouched','status','SKIP','detail','no Elite Cardio rows in ops.sku_effort');
  else
  update ops.sku_effort set status='confirmed', build_location='site', hq_build_minutes=null, hq_build_crew=null, crew=1, build_minutes=30 where sku=(select min(sku) from ops.sku_effort where ops.elite_cardio_item(sku,product_name));
  select to_jsonb(s) into ec_before from ops.sku_effort s where sku=(select min(sku) from ops.sku_effort where ops.elite_cardio_item(sku,product_name));
  update ops.sku_effort set needs_assembly = true, crew = 2, build_minutes = 120, build_location = 'hq', hq_build_minutes = 120, hq_build_crew = 2, site_position_minutes = 45,
    suggestion_rule = case when status = 'suggested' then 'elite-cardio' else suggestion_rule end, updated_at = now()
  where ops.elite_cardio_item(sku, product_name) and status <> 'confirmed';
  select to_jsonb(s) into ec_after from ops.sku_effort s where sku=ec_before->>'sku';
  r := r || jsonb_build_object('t','E3 migration update leaves a confirmed row untouched','ok', ec_before=ec_after);
  end if;

  -- Q: install_prepare_quote_email
  x := pg_temp.run(booker,'authenticated',format('public.install_prepare_quote_email(%L,%L)',q6,'not-an-email'));
  r := r || jsonb_build_object('t','Q1 invalid email refused','ok', x->>'ok'='false' and x->>'err' like '%Enter an email%','err',x->'err');
  x := pg_temp.run(booker,'authenticated',format('public.install_prepare_quote_email(%L,%L)',q6,' Foo@Example.COM '));
  r := r || jsonb_build_object('t','Q2 valid email normalised and stored','ok', x->>'val'='foo@example.com' and (select iq.payload->>'contactEmail' from ops.install_quotes iq where iq.id=q6)='foo@example.com','err',x->'err');
  x := pg_temp.run(booker,'authenticated',format('public.install_prepare_quote_email(%L,%L)',q6,''));
  r := r || jsonb_build_object('t','Q3 empty input returns stored email','ok', x->>'val'='foo@example.com','err',x->'err');
  x := pg_temp.run(eng,'authenticated',format('public.install_prepare_quote_email(%L,%L)',q6,'a@b.co'));
  r := r || jsonb_build_object('t','Q4 field engineer refused','ok', x->>'ok'='false' and x->>'err' like '%cannot book%','err',x->'err');
  x := pg_temp.run(booker,'authenticated',format('public.install_prepare_quote_email(%L,%L)',q1,'a@b.co'));
  r := r || jsonb_build_object('t','Q5 booked quote refused','ok', x->>'ok'='false' and x->>'err' like '%already booked%','err',x->'err');
  x := pg_temp.run(booker,'authenticated',format('public.install_access_email_context(%L)',i1));
  y := pg_temp.run(null,'service_role',format('public.install_access_email_context(%L)',i1));
  r := r || jsonb_build_object('t','Q6 access email context: authenticated denied, service_role allowed','ok', x->>'ok'='false' and y->>'ok'='true' and (y->>'val')::jsonb ? 'repEmail','e1',x->'err');

  -- ---------- report ----------
  raise notice '%', rpad('-', 100, '-');
  raise notice '% | %', rpad('STATUS', 6), 'TEST  (detail)';
  raise notice '%', rpad('-', 100, '-');
  for res in select * from jsonb_array_elements(r) loop
    v_status := coalesce(res->>'status', case when (res->>'ok')::boolean then 'PASS' else 'FAIL' end);
    if staff is null and split_part(res->>'t', ' ', 1) = any (c_sales_only) then
      v_status := 'SKIP'; res := res || '{"detail":"no sales-only user (sales edit, no operations view) found"}';
    end if;
    raise notice '% | %  (%)', rpad(v_status, 6), res->>'t',
      left(coalesce(res->>'detail', nullif(concat_ws(' ', res->>'err', res->>'e1', res->>'e2'), ''), ''), 300);
    if v_status = 'PASS' then n_pass := n_pass + 1;
    elsif v_status = 'FAIL' then n_fail := n_fail + 1;
    elsif v_status = 'SKIP' then n_skip := n_skip + 1;
    end if;
  end loop;
  raise notice '%', rpad('-', 100, '-');
  raise notice 'real crew/van resources parked during the test (restored by the rollback): %', n_deact;
  raise exception 'R2 SMOKE TEST COMPLETE - ROLLED BACK ON PURPOSE. passed=%, failed=%, skipped=% RESULTS:%', n_pass, n_fail, n_skip, r::text;
end
$r2smoke$;
