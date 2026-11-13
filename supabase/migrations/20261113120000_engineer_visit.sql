-- Engineer visit flow. New file only. Do not edit earlier migrations.
-- Field engineers see installs reserved to their resource. Admins and operations see all.
-- Weekends stay unbookable. This file does not write to Cin7.
-- Photos are stored by a signed upload URL. This migration only records the file afterwards.

alter table ops.visit_sheets
  add column sheet_on date,
  add column returned_on date,
  add column ladder_check boolean;

do $$
declare
  v_name text;
begin
  for v_name in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'core.files'::regclass
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%bucket%'
  loop
    execute format('alter table core.files drop constraint %I', v_name);
  end loop;
end $$;

alter table core.files
  add constraint files_bucket_check
  check (bucket in ('access-media', 'job-sheets', 'qc', 'insurance', 'terms', 'documents'));

insert into storage.buckets (id, name, public, file_size_limit)
values ('documents', 'documents', false, 31457280)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit;

create table ops.visit_documents (
  key text primary key check (key in ('catalogue', 'elite_strength', 'performance_strength', 'cardio')),
  file_id uuid not null references core.files (id) on delete restrict,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

comment on table ops.visit_documents is
  'Catalogue and maintenance PDFs uploaded by the office. Missing files are skipped when a job sheet is emailed.';

alter table ops.visit_documents enable row level security;
revoke all on ops.visit_documents from public, anon, authenticated;
grant all on ops.visit_documents to service_role;

create index if not exists resources_profile_idx on ops.resources (profile_id);

create or replace function public.orbit_register_file(
  p_bucket text,
  p_storage_path text,
  p_mime_type text,
  p_byte_size bigint,
  p_checksum text,
  p_uploaded_by uuid,
  p_entity_schema text,
  p_entity_table text,
  p_entity_id uuid,
  p_kind text
)
returns uuid
language plpgsql
security definer
set search_path = core, public
as $$
declare
  v_id uuid;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'app: You cannot register a file.';
  end if;
  if p_bucket not in ('access-media', 'job-sheets', 'qc', 'insurance', 'terms', 'documents') then
    raise exception 'app: That file bucket is not valid.';
  end if;
  if p_storage_path is null
     or p_storage_path !~ '^[a-z0-9][a-z0-9_./-]{0,480}$'
     or p_storage_path like '%..%'
     or p_storage_path like '/%'
  then
    raise exception 'app: That file path is not allowed.';
  end if;
  if p_entity_schema not in ('ops', 'core') then
    raise exception 'app: That file cannot be linked to that record.';
  end if;
  insert into core.files (
    bucket, storage_path, mime_type, byte_size, checksum,
    uploaded_by, entity_schema, entity_table, entity_id, kind
  ) values (
    p_bucket, p_storage_path,
    nullif(trim(coalesce(p_mime_type, '')), ''),
    p_byte_size,
    nullif(trim(coalesce(p_checksum, '')), ''),
    p_uploaded_by, p_entity_schema, p_entity_table, p_entity_id,
    nullif(trim(coalesce(p_kind, '')), '')
  )
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.install_claim_engineer()
returns uuid
language plpgsql
security definer
set search_path = ops, public
as $$
declare
  v_first text;
  v_local text;
  v_id uuid;
  v_count integer;
begin
  if auth.uid() is null then
    return null;
  end if;
  select id into v_id
  from ops.resources
  where profile_id = auth.uid()
    and resource_type in ('installer', 'helper')
    and status = 'active'
  limit 1;
  if v_id is not null then
    return v_id;
  end if;
  if public.workspace_is_admin() then
    return null;
  end if;
  if exists (
    select 1
    from public.workspace_team_members m
    join public.workspace_teams t on t.id = m.team_id
    where m.profile_id = auth.uid()
      and t.name in ('Sales', 'Operations', 'Management', 'Office', 'Aftersales')
  ) then
    return null;
  end if;
  select
    lower(btrim(coalesce(nullif(first_name, ''), split_part(coalesce(full_name, ''), ' ', 1)))),
    lower(split_part(email, '@', 1))
  into v_first, v_local
  from public.profiles
  where id = auth.uid();
  select count(*) into v_count
  from ops.resources r
  where r.profile_id is null
    and r.resource_type in ('installer', 'helper')
    and r.status = 'active'
    and (
      lower(btrim(regexp_replace(r.name, '^.*[—–-]\s*', ''))) = v_first
      or lower(btrim(regexp_replace(r.name, '^.*[—–-]\s*', ''))) = v_local
    );
  if v_count <> 1 then
    return null;
  end if;
  update ops.resources r
  set profile_id = auth.uid()
  where r.profile_id is null
    and r.resource_type in ('installer', 'helper')
    and r.status = 'active'
    and (
      lower(btrim(regexp_replace(r.name, '^.*[—–-]\s*', ''))) = v_first
      or lower(btrim(regexp_replace(r.name, '^.*[—–-]\s*', ''))) = v_local
    )
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function ops.is_field_engineer()
returns boolean
language sql
stable
security definer
set search_path = ops, public
as $$
  select exists (
    select 1 from ops.resources r
    where r.profile_id = auth.uid()
      and r.resource_type in ('installer', 'helper')
      and r.status = 'active'
  );
$$;

create or replace function ops.install_assigned(p_install uuid, p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ops, public
as $$
  select p_profile is not null and (
    exists (
      select 1
      from ops.install_reservations ir
      join ops.resources r on r.id = ir.resource_id
      where ir.install_id = p_install
        and r.profile_id = p_profile
        and r.resource_type in ('installer', 'helper')
    )
    or exists (
      select 1
      from ops.installs i
      cross join lateral jsonb_array_elements(case when jsonb_typeof(i.resources) = 'array' then i.resources else '[]'::jsonb end) elem
      join ops.resources r on r.id::text = elem->>'id'
      where i.id = p_install
        and r.profile_id = p_profile
        and r.resource_type in ('installer', 'helper')
    )
  );
$$;

create or replace function public.install_sees_all()
returns boolean
language sql
stable
security definer
set search_path = ops, public
as $$
  select public.workspace_is_admin()
    or (public.workspace_can('operations', 'edit') and not ops.is_field_engineer());
$$;

create or replace function ops.visit_can(p_install uuid)
returns boolean
language sql
stable
security definer
set search_path = ops, public
as $$
  select public.install_sees_all() or ops.install_assigned(p_install, auth.uid());
$$;

create or replace function ops.assert_job_token(p_install uuid, p_token_hash text)
returns uuid
language plpgsql
security definer
set search_path = ops, core, public
as $$
declare
  v_token jsonb;
  v_id uuid;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'app: You cannot use that link.';
  end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'app: That link is not valid.';
  end if;
  v_token := public.orbit_resolve_token(p_token_hash);
  if v_token is null
     or v_token->>'purpose' is distinct from 'subcontractor_job'
     or v_token->>'entity_table' is distinct from 'installs'
     or (v_token->>'entity_id')::uuid is distinct from p_install
  then
    raise exception 'app: That link is not valid.';
  end if;
  select id into v_id from core.token_links where token_hash = decode(p_token_hash, 'hex');
  return v_id;
end;
$$;

create or replace function ops.order_lines(p_lines jsonb)
returns jsonb
language sql
immutable
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'sku', coalesce(line->>'sku', line->>'code', ''),
    'description', coalesce(line->>'description', line->>'productName', line->>'name', ''),
    'productLine', line->>'productLine',
    'category', coalesce(line->>'category', line->>'cin7Category'),
    'qty', line->'qty'
  )), '[]'::jsonb)
  from jsonb_array_elements(case when jsonb_typeof(p_lines) = 'array' then p_lines else '[]'::jsonb end) line;
$$;

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
begin
  if auth.uid() is null then
    raise exception 'app: You need to be signed in.';
  end if;
  perform public.install_claim_engineer();
  v_all := public.install_sees_all();
  v_role := case
    when public.workspace_is_admin() then 'admin'
    when ops.is_field_engineer() then 'engineer'
    when v_all then 'ops'
    else 'none'
  end;
  return jsonb_build_object(
    'role', v_role,
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

create or replace function ops.visit_payload(p_row ops.installs)
returns jsonb
language sql
stable
security definer
set search_path = ops, public
as $$
  select jsonb_build_object(
    'job', jsonb_build_object(
      'id', p_row.id,
      'orderNumber', p_row.order_number,
      'customerName', p_row.customer_name,
      'siteAddress', p_row.site_address,
      'contactName', p_row.contact_name,
      'contactPhone', p_row.contact_phone,
      'contactEmail', p_row.contact_email,
      'startOn', p_row.start_on,
      'endOn', p_row.end_on,
      'status', p_row.status
    ),
    'lines', ops.order_lines(p_row.lines),
    'risk', (
      select jsonb_build_object('answers', ra.answers, 'concernCount', coalesce(cardinality(ra.concern_file_ids), 0), 'completedAt', ra.completed_at)
      from ops.risk_assessments ra
      where ra.install_id = p_row.id
      order by ra.completed_at desc
      limit 1
    ),
    'submitted', exists (select 1 from ops.visit_sheets vs where vs.install_id = p_row.id and vs.submitted_at is not null)
  );
$$;

create or replace function public.install_visit_context(p_install uuid)
returns jsonb
language plpgsql
security definer
set search_path = ops, public
as $$
declare
  v_row ops.installs%rowtype;
begin
  if auth.uid() is null then
    raise exception 'app: You need to be signed in.';
  end if;
  perform public.install_claim_engineer();
  if not ops.visit_can(p_install) then
    raise exception 'app: You cannot open that job.';
  end if;
  select * into v_row from ops.installs where id = p_install;
  if v_row.id is null then
    raise exception 'app: That job was not found.';
  end if;
  return ops.visit_payload(v_row) || jsonb_build_object(
    'role', case when public.workspace_is_admin() then 'admin' when ops.is_field_engineer() then 'engineer' else 'ops' end,
    'engineerName', coalesce((select nullif(btrim(full_name), '') from public.profiles where id = auth.uid()), '')
  );
end;
$$;

create or replace function public.install_visit_preview(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ops, core, public
as $$
declare
  v_token jsonb;
  v_row ops.installs%rowtype;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'app: You cannot open that job.';
  end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    return null;
  end if;
  v_token := public.orbit_resolve_token(p_token_hash);
  if v_token is null or v_token->>'purpose' is distinct from 'subcontractor_job' or v_token->>'entity_table' is distinct from 'installs' then
    return null;
  end if;
  select * into v_row from ops.installs where id = (v_token->>'entity_id')::uuid;
  if v_row.id is null then
    return null;
  end if;
  return ops.visit_payload(v_row) || jsonb_build_object('role', 'token', 'engineerName', '');
end;
$$;

create or replace function public.install_save_visit_sheet(p_install uuid, p_sheet jsonb, p_token_hash text default null)
returns uuid
language plpgsql
security definer
set search_path = ops, core, public
as $$
declare
  v_id uuid;
  v_token_id uuid;
  v_user uuid;
  v_type text := coalesce(p_sheet->>'visitType', '');
begin
  if not exists (select 1 from ops.installs where id = p_install and status <> 'cancelled') then
    raise exception 'app: That job was not found.';
  end if;
  if exists (select 1 from ops.visit_sheets where install_id = p_install and submitted_at is not null) then
    raise exception 'app: This job sheet is already in.';
  end if;
  if v_type not in ('install', 'service') then
    raise exception 'app: Choose install or service.';
  end if;
  if nullif(btrim(coalesce(p_sheet->>'customerName', '')), '') is null then
    raise exception 'app: Add the customer name.';
  end if;
  if nullif(btrim(coalesce(p_sheet->>'engineerName', '')), '') is null then
    raise exception 'app: Add the engineer name.';
  end if;
  if nullif(btrim(coalesce(p_sheet->>'workCarriedOut', '')), '') is null then
    raise exception 'app: Add the work carried out.';
  end if;
  if coalesce(nullif(p_sheet->>'ladderCheck', '')::boolean, false) is not true then
    raise exception 'app: Confirm the ladder check.';
  end if;
  if nullif(p_sheet->>'engineerSignatureFileId', '') is null or nullif(p_sheet->>'customerSignatureFileId', '') is null then
    raise exception 'app: Both signatures are required.';
  end if;
  if nullif(p_sheet->>'pdfFileId', '') is null then
    raise exception 'app: The job sheet PDF is missing.';
  end if;
  if p_token_hash is not null then
    v_token_id := ops.assert_job_token(p_install, p_token_hash);
  else
    perform public.install_claim_engineer();
    if not ops.visit_can(p_install) then
      raise exception 'app: You cannot save that job sheet.';
    end if;
    v_user := auth.uid();
  end if;
  insert into ops.visit_sheets (
    install_id, visit_type, contact_name, address, phone, order_no, job_no,
    service_contract, call_out_charge, time_on, time_off, overnight_stay, parking_fee,
    did_service, did_delivery, did_installation, did_warranty, work_carried_out,
    location_ok, fixing_wall, fixing_floor, work_ok, site_ok,
    engineer_name, vehicle_reg, customer_name,
    engineer_signature_file_id, customer_signature_file_id, pdf_file_id,
    completed_by, token_link_id, submitted_at, sheet_on, returned_on, ladder_check
  ) values (
    p_install, v_type,
    p_sheet->>'contactName', p_sheet->>'address', p_sheet->>'phone', p_sheet->>'orderNo', p_sheet->>'jobNo',
    nullif(p_sheet->>'serviceContract', '')::boolean,
    nullif(p_sheet->>'callOutCharge', '')::boolean,
    case when coalesce(p_sheet->>'timeOn', '') ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$' then (p_sheet->>'timeOn')::timestamptz else null end,
    case when coalesce(p_sheet->>'timeOff', '') ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$' then (p_sheet->>'timeOff')::timestamptz else null end,
    nullif(p_sheet->>'overnightStay', '')::boolean,
    case when coalesce(p_sheet->>'parkingFee', '') ~ '^[0-9]+(\.[0-9]{1,2})?$' then (p_sheet->>'parkingFee')::numeric else null end,
    coalesce(nullif(p_sheet->>'service', '')::boolean, false),
    coalesce(nullif(p_sheet->>'delivery', '')::boolean, false),
    coalesce(nullif(p_sheet->>'installation', '')::boolean, false),
    coalesce(nullif(p_sheet->>'warranty', '')::boolean, false),
    p_sheet->>'workCarriedOut',
    nullif(p_sheet->>'locationOk', '')::boolean,
    nullif(p_sheet->>'fixingWall', '')::boolean,
    nullif(p_sheet->>'fixingFloor', '')::boolean,
    nullif(p_sheet->>'workOk', '')::boolean,
    nullif(p_sheet->>'siteOk', '')::boolean,
    p_sheet->>'engineerName', p_sheet->>'vehicleReg', p_sheet->>'customerName',
    nullif(p_sheet->>'engineerSignatureFileId', '')::uuid,
    nullif(p_sheet->>'customerSignatureFileId', '')::uuid,
    nullif(p_sheet->>'pdfFileId', '')::uuid,
    v_user, v_token_id, now(),
    case when coalesce(p_sheet->>'sheetOn', '') ~ '^\d{4}-\d{2}-\d{2}$' then (p_sheet->>'sheetOn')::date else null end,
    case when coalesce(p_sheet->>'returnedOn', '') ~ '^\d{4}-\d{2}-\d{2}$' then (p_sheet->>'returnedOn')::date else null end,
    true
  )
  returning id into v_id;
  insert into ops.visit_sheet_lines (visit_sheet_id, position, code, description, reported_job)
  select v_id, ordinality::integer, item->>'code', item->>'description', item->>'reportedJob'
  from jsonb_array_elements(coalesce(p_sheet->'lines', '[]'::jsonb)) with ordinality as listed(item, ordinality);
  insert into ops.visit_sheet_parts (visit_sheet_id, position, code, description, qty)
  select v_id, ordinality::integer, item->>'code', item->>'description',
    case when coalesce(item->>'qty', '') ~ '^[0-9]+(\.[0-9]{1,2})?$' and (item->>'qty')::numeric > 0 then (item->>'qty')::numeric else 1 end
  from jsonb_array_elements(coalesce(p_sheet->'parts', '[]'::jsonb)) with ordinality as listed(item, ordinality);
  return v_id;
end;
$$;

create or replace function public.install_save_risk(p_install uuid, p_answers jsonb, p_concern_file_ids uuid[])
returns uuid
language plpgsql
security definer
set search_path = ops, public
as $$
declare
  v_id uuid;
begin
  perform public.install_claim_engineer();
  if not ops.visit_can(p_install) then
    raise exception 'app: You cannot save that risk assessment.';
  end if;
  insert into ops.risk_assessments (install_id, answers, concern_file_ids, completed_by)
  values (p_install, coalesce(p_answers, '{}'::jsonb), coalesce(p_concern_file_ids, '{}'), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.install_save_visit_risk(p_install uuid, p_answers jsonb, p_concern_file_ids uuid[], p_token_hash text default null)
returns uuid
language plpgsql
security definer
set search_path = ops, public
as $$
declare
  v_id uuid;
  v_answers jsonb := coalesce(p_answers, '{}'::jsonb);
  v_key text;
begin
  if not exists (select 1 from ops.installs where id = p_install and status <> 'cancelled') then
    raise exception 'app: That job was not found.';
  end if;
  if jsonb_typeof(v_answers) <> 'object' then
    raise exception 'app: The risk assessment could not be read.';
  end if;
  foreach v_key in array ARRAY['accessClear', 'floorSuitable', 'powerSafe', 'handlingPlanned', 'peopleBriefed', 'ladderCheck']
  loop
    if coalesce(v_answers->>v_key, '') not in ('true', 'false') then
      raise exception 'app: Answer every check.';
    end if;
  end loop;
  if exists (
    select 1 from unnest(coalesce(p_concern_file_ids, '{}')) as fid
    where not exists (select 1 from core.files f where f.id = fid and f.entity_id = p_install)
  ) then
    raise exception 'app: That photo is not on this job.';
  end if;
  if p_token_hash is not null then
    perform ops.assert_job_token(p_install, p_token_hash);
  else
    perform public.install_claim_engineer();
    if not ops.visit_can(p_install) then
      raise exception 'app: You cannot save that risk assessment.';
    end if;
  end if;
  insert into ops.risk_assessments (install_id, answers, concern_file_ids, completed_by)
  values (p_install, v_answers, coalesce(p_concern_file_ids, '{}'), case when p_token_hash is null then auth.uid() else null end)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.install_commit_visit(p_install uuid, p_sheet jsonb, p_photo_ids uuid[], p_token_hash text default null)
returns jsonb
language plpgsql
security definer
set search_path = ops, core, public
as $$
declare
  v_sheet uuid;
  v_row ops.installs%rowtype;
begin
  if coalesce(array_length(p_photo_ids, 1), 0) < 1 then
    raise exception 'app: Add a photo of the equipment.';
  end if;
  if not exists (select 1 from ops.risk_assessments where install_id = p_install) then
    raise exception 'app: Save the risk assessment before the job sheet.';
  end if;
  if exists (
    select 1 from unnest(p_photo_ids) as fid
    where not exists (select 1 from core.files f where f.id = fid and f.entity_id = p_install)
  ) then
    raise exception 'app: That photo is not on this job.';
  end if;
  v_sheet := public.install_save_visit_sheet(p_install, p_sheet, p_token_hash);
  insert into ops.install_equipment_photos (install_id, visit_sheet_id, file_id)
  select p_install, v_sheet, fid from unnest(p_photo_ids) as fid;
  update ops.installs
  set status = 'completed', updated_at = now()
  where id = p_install and status <> 'cancelled'
  returning * into v_row;
  insert into core.notifications (user_id, title, body, kind, channel, link, entity_schema, entity_table, entity_id)
  values (
    v_row.booking_rep_id,
    'Job sheet completed',
    v_row.customer_name || ' · ' || v_row.order_number,
    'visit_sheet',
    'in_app',
    '/sales/installs/' || v_row.id::text,
    'ops', 'installs', v_row.id
  );
  return jsonb_build_object(
    'sheetId', v_sheet,
    'contactEmail', v_row.contact_email,
    'orderNumber', v_row.order_number,
    'customerName', v_row.customer_name,
    'lines', ops.order_lines(v_row.lines)
  );
end;
$$;

create or replace function public.install_concern_files(p_install uuid, p_token_hash text default null)
returns jsonb
language plpgsql
security definer
set search_path = ops, core, public
as $$
begin
  if p_token_hash is not null then
    perform ops.assert_job_token(p_install, p_token_hash);
  else
    perform public.install_claim_engineer();
    if not ops.visit_can(p_install) then
      raise exception 'app: You cannot open that job.';
    end if;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', f.id, 'bucket', f.bucket, 'path', f.storage_path) order by f.created_at)
    from ops.risk_assessments ra
    cross join lateral unnest(ra.concern_file_ids) as mid(file_id)
    join core.files f on f.id = mid.file_id
    where ra.id = (select id from ops.risk_assessments where install_id = p_install order by completed_at desc limit 1)
  ), '[]'::jsonb);
end;
$$;

create or replace function public.install_my_signature()
returns jsonb
language plpgsql
security definer
set search_path = ops, core, public
as $$
declare
  v_row jsonb;
begin
  if auth.uid() is null then
    raise exception 'app: Sign in to save a signature.';
  end if;
  select jsonb_build_object('fileId', f.id, 'bucket', f.bucket, 'path', f.storage_path)
  into v_row
  from ops.staff_signatures s
  join core.files f on f.id = s.file_id
  where s.profile_id = auth.uid();
  return v_row;
end;
$$;

create or replace function public.install_list_visit_documents()
returns jsonb
language plpgsql
security definer
set search_path = ops, core, public
as $$
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    perform public.install_claim_engineer();
    if not (public.install_sees_all() or public.workspace_can('operations', 'view') or ops.is_field_engineer()) then
      raise exception 'app: You cannot read those documents.';
    end if;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('key', d.key, 'fileId', d.file_id, 'bucket', f.bucket, 'path', f.storage_path, 'updatedAt', d.updated_at) order by d.key)
    from ops.visit_documents d
    join core.files f on f.id = d.file_id
  ), '[]'::jsonb);
end;
$$;

create or replace function public.install_save_visit_document(p_key text, p_file_id uuid)
returns void
language plpgsql
security definer
set search_path = ops, core, public
as $$
begin
  perform public.install_claim_engineer();
  if not public.install_sees_all() then
    raise exception 'app: You cannot update those documents.';
  end if;
  if p_key not in ('catalogue', 'elite_strength', 'performance_strength', 'cardio') then
    raise exception 'app: That document is not on the list.';
  end if;
  if not exists (select 1 from core.files f where f.id = p_file_id and f.bucket = 'documents' and f.mime_type = 'application/pdf') then
    raise exception 'app: Upload a PDF.';
  end if;
  insert into ops.visit_documents (key, file_id, updated_by)
  values (p_key, p_file_id, auth.uid())
  on conflict (key) do update
  set file_id = excluded.file_id, updated_by = excluded.updated_by, updated_at = now();
end;
$$;

create or replace function public.install_engineer_links()
returns jsonb
language plpgsql
security definer
set search_path = ops, public
as $$
begin
  perform public.install_claim_engineer();
  if not public.install_sees_all() then
    raise exception 'app: You cannot view engineer logins.';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('name', r.name, 'linked', r.profile_id is not null, 'profileName', p.full_name) order by r.name)
    from ops.resources r
    left join public.profiles p on p.id = r.profile_id
    where r.id in (
      'f3000000-0000-4000-8000-000000000001',
      'f3000000-0000-4000-8000-000000000002',
      'f3000000-0000-4000-8000-000000000003',
      'f3000000-0000-4000-8000-000000000004'
    )
  ), '[]'::jsonb);
end;
$$;

drop function if exists public.install_calendar(date, date, boolean);
drop function if exists public.install_read(uuid);

create or replace function public.install_calendar(p_from date, p_to date, p_mine boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ops, public
as $$
declare
  v_ops boolean := public.workspace_can('operations', 'view') or public.workspace_is_admin();
  v_sales boolean := v_ops or public.workspace_can('sales', 'view');
begin
  perform public.install_claim_engineer();
  if not v_sales then
    raise exception 'app: You cannot see installs.';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'app: Choose a date range.';
  end if;
  return coalesce((
    select jsonb_agg(ops.install_span(i) || case when v_ops then jsonb_build_object(
      'flags', i.flags, 'hqBuild', i.hq_build, 'siteInstall', i.site_install, 'crew', i.crew,
      'vans', jsonb_build_object('size', i.van_size, 'count', i.van_count),
      'resources', i.resources, 'lines', i.lines, 'cin7SaleId', i.cin7_sale_id, 'cin7CustomerId', i.cin7_customer_id
    ) else '{}'::jsonb end order by i.start_on, i.order_number)
    from ops.installs i
    where i.status <> 'cancelled'
      and i.start_on <= p_to
      and i.end_on >= p_from
      and (not coalesce(p_mine, false) or i.booking_rep_id = auth.uid())
      and (public.workspace_is_admin() or not ops.is_field_engineer() or ops.install_assigned(i.id, auth.uid()))
  ), '[]'::jsonb);
end;
$$;

create or replace function public.install_read(p_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ops, public
as $$
declare
  v_row ops.installs%rowtype;
  v_ops boolean := public.workspace_can('operations', 'view') or public.workspace_is_admin();
begin
  perform public.install_claim_engineer();
  if not (v_ops or public.workspace_can('sales', 'view')) then
    raise exception 'app: You cannot see that install.';
  end if;
  if ops.is_field_engineer() and not public.workspace_is_admin() and not ops.install_assigned(p_id, auth.uid()) then
    raise exception 'app: You cannot see that install.';
  end if;
  select * into v_row from ops.installs where id = p_id;
  if v_row.id is null then
    raise exception 'app: That install was not found.';
  end if;
  return ops.install_span(v_row) || case when v_ops then jsonb_build_object(
    'flags', v_row.flags, 'hqBuild', v_row.hq_build, 'siteInstall', v_row.site_install, 'crew', v_row.crew,
    'vans', jsonb_build_object('size', v_row.van_size, 'count', v_row.van_count),
    'resources', v_row.resources, 'lines', v_row.lines, 'cin7SaleId', v_row.cin7_sale_id, 'cin7CustomerId', v_row.cin7_customer_id
  ) else '{}'::jsonb end;
end;
$$;

create or replace function public.install_set_status(p_id uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = ops, public
as $$
begin
  perform public.install_claim_engineer();
  if ops.is_field_engineer() and not public.workspace_is_admin() then
    raise exception 'app: You cannot change that install.';
  end if;
  if not public.workspace_can('operations', 'edit') then
    raise exception 'app: You cannot change that install.';
  end if;
  if p_status not in ('booked', 'scheduled', 'in_progress', 'completed', 'cancelled') then
    raise exception 'app: Choose a status.';
  end if;
  update ops.installs set status = p_status, updated_at = now() where id = p_id;
  if not found then
    raise exception 'app: That install was not found.';
  end if;
  if p_status = 'cancelled' then
    delete from ops.install_reservations where install_id = p_id;
  end if;
  return public.install_read(p_id);
end;
$$;

create or replace function public.install_move(p_id uuid, p_start date)
returns jsonb
language plpgsql
security definer
set search_path = ops, public
as $$
declare
  v_row ops.installs%rowtype;
  v_quote ops.install_quotes%rowtype;
  v_total integer;
  v_days date[];
  v_ids uuid[];
  v_end date;
  v_weekends boolean := false;
  v_requirements jsonb;
  v_resources jsonb;
begin
  perform public.install_claim_engineer();
  if ops.is_field_engineer() and not public.workspace_is_admin() then
    raise exception 'app: You cannot move that install.';
  end if;
  if not public.workspace_can('operations', 'edit') then
    raise exception 'app: You cannot move that install.';
  end if;
  select * into v_row from ops.installs where id = p_id for update;
  if v_row.id is null or v_row.status = 'cancelled' then
    raise exception 'app: That install was not found.';
  end if;
  select * into v_quote from ops.install_quotes where id = v_row.quote_id;
  v_total := greatest(coalesce((v_quote.payload->>'totalDays')::integer, 1), 1);
  select coalesce(array_agg(day order by day), '{}') into v_days from ops.install_working_days(p_start, v_total, v_weekends) as day;
  if coalesce(array_length(v_days, 1), 0) < v_total or v_days[1] is distinct from p_start then
    raise exception 'app: Choose a weekday start date.';
  end if;
  delete from ops.install_reservations where install_id = v_row.id;
  v_requirements := coalesce(v_quote.payload->'requirements', '{}'::jsonb);
  v_ids := ops.pick_install_resources(
    v_days, v_row.crew,
    greatest(coalesce((v_requirements->>'licensedDrivers')::integer, 0), 0),
    v_row.van_size, v_row.van_count,
    coalesce((v_requirements->>'stairClimber')::boolean, false)
  );
  if v_ids is null then
    raise exception 'app: Those engineers or vans are no longer free. Choose another start date.';
  end if;
  v_end := v_days[array_length(v_days, 1)];
  v_resources := ops.hold_install_resources(v_row.id, v_ids, v_days);
  update ops.installs set start_on = p_start, end_on = v_end, resources = v_resources, updated_at = now() where id = v_row.id;
  return public.install_read(v_row.id);
end;
$$;

revoke all on function ops.is_field_engineer() from public, anon, authenticated;
revoke all on function ops.install_assigned(uuid, uuid) from public, anon, authenticated;
revoke all on function ops.visit_can(uuid) from public, anon, authenticated;
revoke all on function ops.assert_job_token(uuid, text) from public, anon, authenticated;
revoke all on function ops.order_lines(jsonb) from public, anon, authenticated;
revoke all on function ops.visit_payload(ops.installs) from public, anon, authenticated;
revoke all on function public.install_claim_engineer() from public, anon;
revoke all on function public.install_sees_all() from public, anon;
revoke all on function public.install_field_home() from public, anon;
revoke all on function public.install_visit_context(uuid) from public, anon;
revoke all on function public.install_visit_preview(text) from public, anon;
revoke all on function public.install_save_visit_risk(uuid, jsonb, uuid[], text) from public, anon;
revoke all on function public.install_commit_visit(uuid, jsonb, uuid[], text) from public, anon;
revoke all on function public.install_concern_files(uuid, text) from public, anon;
revoke all on function public.install_my_signature() from public, anon;
revoke all on function public.install_list_visit_documents() from public, anon;
revoke all on function public.install_save_visit_document(text, uuid) from public, anon;
revoke all on function public.install_engineer_links() from public, anon;

grant execute on function public.install_claim_engineer() to authenticated, service_role;
grant execute on function public.install_sees_all() to authenticated, service_role;
grant execute on function public.install_field_home() to authenticated, service_role;
grant execute on function public.install_visit_context(uuid) to authenticated, service_role;
grant execute on function public.install_visit_preview(text) to service_role;
grant execute on function public.install_save_visit_risk(uuid, jsonb, uuid[], text) to authenticated, service_role;
grant execute on function public.install_commit_visit(uuid, jsonb, uuid[], text) to authenticated, service_role;
grant execute on function public.install_concern_files(uuid, text) to authenticated, service_role;
grant execute on function public.install_my_signature() to authenticated, service_role;
grant execute on function public.install_list_visit_documents() to authenticated, service_role;
grant execute on function public.install_save_visit_document(text, uuid) to authenticated, service_role;
grant execute on function public.install_engineer_links() to authenticated, service_role;
grant execute on function public.install_calendar(date, date, boolean) to authenticated, service_role;
grant execute on function public.install_read(uuid) to authenticated, service_role;
