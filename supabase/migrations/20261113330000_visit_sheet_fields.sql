-- The job sheet form no longer collects a ladder check, call-out, overnight stay,
-- or wall and floor fixing answers. Those columns stay nullable and are stored
-- as null. The risk assessment asks only for the five checks on the form.

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
  v_engineer uuid;
  v_customer uuid;
  v_pdf uuid;
begin
  if p_token_hash is not null then
    v_token_id := ops.assert_job_token(p_install, p_token_hash);
  else
    if not ops.visit_can(p_install) then
      raise exception 'app: You cannot save that job sheet.';
    end if;
    v_user := auth.uid();
  end if;
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
  if nullif(p_sheet->>'engineerSignatureFileId', '') is null
     or nullif(p_sheet->>'customerSignatureFileId', '') is null then
    raise exception 'app: Both signatures are required.';
  end if;
  if nullif(p_sheet->>'pdfFileId', '') is null then
    raise exception 'app: The job sheet PDF is missing.';
  end if;
  v_engineer := nullif(p_sheet->>'engineerSignatureFileId', '')::uuid;
  v_customer := nullif(p_sheet->>'customerSignatureFileId', '')::uuid;
  v_pdf := nullif(p_sheet->>'pdfFileId', '')::uuid;
  if not (
    ops.install_file_ok(p_install, v_engineer, 'job-sheets', array['engineer_signature'])
    or (
      p_token_hash is null
      and exists (
        select 1
        from ops.staff_signatures s
        join core.files f on f.id = s.file_id
        where s.profile_id = auth.uid()
          and s.file_id = v_engineer
          and f.bucket = 'job-sheets'
      )
    )
  ) then
    raise exception 'app: That engineer signature is not on this job.';
  end if;
  if not ops.install_file_ok(p_install, v_customer, 'job-sheets', array['customer_signature']) then
    raise exception 'app: That customer signature is not on this job.';
  end if;
  if not ops.install_file_ok(p_install, v_pdf, 'job-sheets', array['visit_pack'])
     or not exists (select 1 from core.files f where f.id = v_pdf and f.mime_type = 'application/pdf') then
    raise exception 'app: The job sheet PDF is missing.';
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
    null,
    case when coalesce(p_sheet->>'timeOn', '') ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$' then (p_sheet->>'timeOn')::timestamptz else null end,
    case when coalesce(p_sheet->>'timeOff', '') ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$' then (p_sheet->>'timeOff')::timestamptz else null end,
    null,
    case when coalesce(p_sheet->>'parkingFee', '') ~ '^[0-9]+(\.[0-9]{1,2})?$' then (p_sheet->>'parkingFee')::numeric else null end,
    coalesce(nullif(p_sheet->>'service', '')::boolean, false),
    coalesce(nullif(p_sheet->>'delivery', '')::boolean, false),
    coalesce(nullif(p_sheet->>'installation', '')::boolean, false),
    coalesce(nullif(p_sheet->>'warranty', '')::boolean, false),
    p_sheet->>'workCarriedOut',
    nullif(p_sheet->>'locationOk', '')::boolean,
    null,
    null,
    nullif(p_sheet->>'workOk', '')::boolean,
    nullif(p_sheet->>'siteOk', '')::boolean,
    p_sheet->>'engineerName', p_sheet->>'vehicleReg', p_sheet->>'customerName',
    v_engineer, v_customer, v_pdf,
    v_user, v_token_id, now(),
    case when coalesce(p_sheet->>'sheetOn', '') ~ '^\d{4}-\d{2}-\d{2}$' then (p_sheet->>'sheetOn')::date else null end,
    case when coalesce(p_sheet->>'returnedOn', '') ~ '^\d{4}-\d{2}-\d{2}$' then (p_sheet->>'returnedOn')::date else null end,
    null
  )
  returning id into v_id;

  insert into ops.visit_sheet_lines (visit_sheet_id, position, code, description, reported_job, qty)
  select v_id, ordinality::integer, item->>'code', item->>'description', item->>'reportedJob',
    case when coalesce(item->>'qty', '') ~ '^[0-9]+(\.[0-9]{1,2})?$' and (item->>'qty')::numeric > 0 then (item->>'qty')::numeric else null end
  from jsonb_array_elements(coalesce(p_sheet->'lines', '[]'::jsonb)) with ordinality as listed(item, ordinality);

  insert into ops.visit_sheet_parts (visit_sheet_id, position, code, description, qty)
  select v_id, ordinality::integer, item->>'code', item->>'description',
    case when coalesce(item->>'qty', '') ~ '^[0-9]+(\.[0-9]{1,2})?$' and (item->>'qty')::numeric > 0 then (item->>'qty')::numeric else 1 end
  from jsonb_array_elements(coalesce(p_sheet->'parts', '[]'::jsonb)) with ordinality as listed(item, ordinality);
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
  if p_token_hash is not null then
    perform ops.assert_job_token(p_install, p_token_hash);
  elsif not ops.visit_can(p_install) then
    raise exception 'app: You cannot save that risk assessment.';
  end if;
  if not exists (select 1 from ops.installs where id = p_install and status <> 'cancelled') then
    raise exception 'app: That job was not found.';
  end if;
  if exists (select 1 from ops.visit_sheets where install_id = p_install and submitted_at is not null) then
    raise exception 'app: This job sheet is already in.';
  end if;
  if jsonb_typeof(v_answers) <> 'object' then
    raise exception 'app: The risk assessment could not be read.';
  end if;
  foreach v_key in array ARRAY['accessClear', 'floorSuitable', 'powerSafe', 'handlingPlanned', 'peopleBriefed']
  loop
    if coalesce(v_answers->>v_key, '') not in ('true', 'false') then
      raise exception 'app: Answer every check.';
    end if;
  end loop;
  if exists (
    select 1 from unnest(coalesce(p_concern_file_ids, '{}')) as fid
    where not ops.install_file_ok(p_install, fid, 'job-sheets', array['concern'])
  ) then
    raise exception 'app: That photo is not on this job.';
  end if;
  insert into ops.risk_assessments (install_id, answers, concern_file_ids, completed_by)
  values (p_install, v_answers, coalesce(p_concern_file_ids, '{}'), case when p_token_hash is null then auth.uid() else null end)
  returning id into v_id;
  return v_id;
end;
$$;

