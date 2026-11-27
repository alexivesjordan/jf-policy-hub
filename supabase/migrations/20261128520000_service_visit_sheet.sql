-- Service visits use the install job sheet and skip the risk assessment.
-- New file only. Do not edit 20261128500000 or 20261128510000. Do not apply to production.

alter table ops.visit_sheets
  add column service_visit_id uuid references svc.visits (id) on delete cascade;

alter table ops.visit_sheets
  alter column install_id drop not null;

alter table ops.visit_sheets
  drop constraint if exists visit_sheets_one_job;

alter table ops.visit_sheets
  add constraint visit_sheets_one_job check (
    (install_id is not null)::integer + (service_visit_id is not null)::integer = 1
  );

create unique index visit_sheets_service_uidx
  on ops.visit_sheets (service_visit_id)
  where service_visit_id is not null;

comment on column ops.visit_sheets.service_visit_id is
  'Set for a Pulse Service visit. Install sheets keep install_id and leave this empty.';

-- Completing a service visit is the job sheet. The old note and photo stay readable.
create or replace function public.service_visit_set_progress(
  p_visit uuid,
  p_status text,
  p_note text,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = svc, public
as $$
declare
  v_status text := svc.clean_text(p_status, 20);
  v_reason text := svc.clean_text(p_reason, 500);
begin
  if not (svc.visit_mine(p_visit) or svc.office('edit')) then
    raise exception 'app: You cannot update that visit.';
  end if;
  if v_status = 'done' then
    raise exception 'app: Complete the job sheet.';
  end if;
  if v_status is null or v_status not in ('scheduled', 'en_route', 'on_site', 'incomplete') then
    raise exception 'app: Choose a status.';
  end if;
  if v_status = 'incomplete' and v_reason is null then
    raise exception 'app: Add a reason.';
  end if;
  update svc.visits
  set status = v_status,
      incomplete_reason = case when v_status = 'incomplete' then v_reason else null end,
      arrived_at = case
        when v_status = 'on_site' then coalesce(arrived_at, now())
        else arrived_at
      end,
      completed_at = case
        when v_status = 'incomplete' then coalesce(completed_at, now())
        when v_status in ('scheduled', 'en_route') then null
        else completed_at
      end
  where id = p_visit;
  if not found then
    raise exception 'app: That visit was not found.';
  end if;
end;
$$;

revoke execute on function public.service_visit_add_photo(uuid, uuid) from authenticated;

create or replace function public.service_visit_upload_gate(p_visit uuid, p_kind text)
returns void
language plpgsql
security definer
set search_path = svc, ops, core, public
as $$
begin
  if p_kind is distinct from 'equipment' then
    raise exception 'app: That photo is not allowed.';
  end if;
  if not (svc.visit_mine(p_visit) or svc.office('edit')) then
    raise exception 'app: You cannot open that visit.';
  end if;
  if not exists (select 1 from svc.visits where id = p_visit) then
    raise exception 'app: That visit was not found.';
  end if;
  if exists (
    select 1 from ops.visit_sheets
    where service_visit_id = p_visit and submitted_at is not null
  ) then
    raise exception 'app: This job sheet is already in.';
  end if;
  if (
    select count(*)
    from core.files f
    where f.entity_id = p_visit
      and f.bucket = 'job-sheets'
      and f.kind = 'equipment'
  ) >= 40 then
    raise exception 'app: That visit already has enough photos.';
  end if;
end;
$$;

create or replace function public.service_save_visit_sheet(
  p_visit uuid,
  p_sheet jsonb,
  p_photo_ids uuid[] default '{}'::uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = svc, ops, core, public
as $$
declare
  v_id uuid;
  v_user uuid := auth.uid();
  v_engineer uuid;
  v_customer uuid;
  v_pdf uuid;
  v_task uuid;
  v_body text;
  v_email text;
  v_customer_name text;
  v_order text;
begin
  if not (svc.visit_mine(p_visit) or svc.office('edit')) then
    raise exception 'app: You cannot save that job sheet.';
  end if;
  if not exists (select 1 from svc.visits where id = p_visit) then
    raise exception 'app: That visit was not found.';
  end if;
  if exists (
    select 1 from ops.visit_sheets
    where service_visit_id = p_visit and submitted_at is not null
  ) then
    raise exception 'app: This job sheet is already in.';
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
  if coalesce(array_length(p_photo_ids, 1), 0) < 1 then
    raise exception 'app: Add a photo of the equipment.';
  end if;
  v_engineer := nullif(p_sheet->>'engineerSignatureFileId', '')::uuid;
  v_customer := nullif(p_sheet->>'customerSignatureFileId', '')::uuid;
  v_pdf := nullif(p_sheet->>'pdfFileId', '')::uuid;
  if not (
    ops.install_file_ok(p_visit, v_engineer, 'job-sheets', array['engineer_signature'])
    or exists (
      select 1
      from ops.staff_signatures s
      join core.files f on f.id = s.file_id
      where s.profile_id = v_user
        and s.file_id = v_engineer
        and f.bucket = 'job-sheets'
    )
  ) then
    raise exception 'app: That engineer signature is not on this visit.';
  end if;
  if not ops.install_file_ok(p_visit, v_customer, 'job-sheets', array['customer_signature']) then
    raise exception 'app: That customer signature is not on this visit.';
  end if;
  if not ops.install_file_ok(p_visit, v_pdf, 'job-sheets', array['visit_pack'])
     or not exists (select 1 from core.files f where f.id = v_pdf and f.mime_type = 'application/pdf') then
    raise exception 'app: The job sheet PDF is missing.';
  end if;
  if exists (
    select 1
    from unnest(p_photo_ids) as wanted(id)
    where not ops.install_file_ok(p_visit, wanted.id, 'job-sheets', array['equipment'])
  ) then
    raise exception 'app: That photo is not on this visit.';
  end if;
  if coalesce(p_sheet->>'floorSheeting', '') not in ('true', 'false')
     or coalesce(p_sheet->>'builtCheckedTag', '') not in ('true', 'false')
     or coalesce(p_sheet->>'dustCover', '') not in ('true', 'false') then
    raise exception 'app: Answer every check.';
  end if;

  insert into ops.visit_sheets (
    install_id, service_visit_id, visit_type, contact_name, address, phone, order_no, job_no,
    service_contract, call_out_charge, time_on, time_off, overnight_stay, parking_fee,
    did_service, did_delivery, did_installation, did_warranty, work_carried_out,
    location_ok, fixing_wall, fixing_floor, work_ok, site_ok,
    floor_sheeting, built_checked_tag, dust_cover,
    engineer_name, vehicle_reg, customer_name,
    engineer_signature_file_id, customer_signature_file_id, pdf_file_id,
    completed_by, token_link_id, submitted_at, sheet_on, returned_on, ladder_check
  ) values (
    null, p_visit, 'service',
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
    nullif(p_sheet->>'floorSheeting', '')::boolean,
    nullif(p_sheet->>'builtCheckedTag', '')::boolean,
    nullif(p_sheet->>'dustCover', '')::boolean,
    p_sheet->>'engineerName', p_sheet->>'vehicleReg', p_sheet->>'customerName',
    v_engineer, v_customer, v_pdf,
    v_user, null, now(),
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

  insert into ops.visit_sheet_lines (visit_sheet_id, position, code, description, reported_job, qty, fulfilment)
  select v_id,
    1000 + ordinality::integer,
    nullif(btrim(coalesce(item->>'code', '')), ''),
    nullif(btrim(coalesce(item->>'description', '')), ''),
    null,
    case when coalesce(item->>'qty', '') ~ '^[0-9]+(\.[0-9]{1,2})?$' and (item->>'qty')::numeric > 0 then (item->>'qty')::numeric else null end,
    item->>'fulfilment'
  from jsonb_array_elements(coalesce(p_sheet->'kitLines', '[]'::jsonb)) with ordinality as listed(item, ordinality)
  where item->>'fulfilment' in ('installed', 'to_follow')
    and (
      nullif(btrim(coalesce(item->>'code', '')), '') is not null
      or nullif(btrim(coalesce(item->>'description', '')), '') is not null
    );

  if exists (
    select 1 from ops.visit_sheet_lines
    where visit_sheet_id = v_id and fulfilment = 'to_follow'
  ) then
    select string_agg(
      btrim(concat_ws(' ',
        case when l.qty is null then null else trim(to_char(l.qty, 'FM999999990.##')) || ' x' end,
        coalesce(nullif(btrim(l.description), ''), nullif(btrim(l.code), ''), 'Item')
      )),
      E'\n'
      order by l.position
    )
    into v_body
    from ops.visit_sheet_lines l
    where l.visit_sheet_id = v_id and l.fulfilment = 'to_follow';

    insert into core.tasks (
      module_id, kind, title, body, priority,
      entity_schema, entity_table, entity_id, assignee_id, created_by
    )
    values (
      'service', 'general', 'Kit still to follow', coalesce(v_body, 'Outstanding kit'), 'normal',
      'ops', 'service_visits', p_visit, null, v_user
    )
    returning id into v_task;

    update ops.visit_sheets set follow_up_task_id = v_task where id = v_id;
  end if;

  update svc.visits
  set status = 'done',
      incomplete_reason = null,
      arrived_at = coalesce(arrived_at, now()),
      completed_at = coalesce(completed_at, now())
  where id = p_visit;

  select c.email, s.customer_name, coalesce(v.cin7_order_number, '')
  into v_email, v_customer_name, v_order
  from svc.visits v
  join svc.sites s on s.id = v.site_id
  left join svc.site_contacts c on c.site_id = v.site_id and c.is_primary
  where v.id = p_visit;

  return jsonb_build_object(
    'id', v_id,
    'contactEmail', v_email,
    'customerName', v_customer_name,
    'orderNumber', v_order
  );
end;
$$;

create or replace function public.service_visit_sheet(p_visit uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = svc, ops, core, public
as $$
declare
  v_sheet ops.visit_sheets%rowtype;
  v_bucket text;
  v_path text;
begin
  if not (svc.visit_mine(p_visit) or svc.office('view')) then
    raise exception 'app: That visit was not found.';
  end if;
  select * into v_sheet
  from ops.visit_sheets
  where service_visit_id = p_visit and submitted_at is not null
  order by submitted_at desc
  limit 1;
  if v_sheet.id is null then
    return jsonb_build_object('submitted', false);
  end if;
  select f.bucket, f.storage_path into v_bucket, v_path
  from core.files f
  where f.id = v_sheet.pdf_file_id;
  return jsonb_build_object(
    'submitted', true,
    'submittedAt', v_sheet.submitted_at,
    'pdfBucket', v_bucket,
    'pdfPath', v_path
  );
end;
$$;

revoke all on function public.service_visit_upload_gate(uuid, text) from public, anon;
revoke all on function public.service_save_visit_sheet(uuid, jsonb, uuid[]) from public, anon;
revoke all on function public.service_visit_sheet(uuid) from public, anon;

grant execute on function public.service_visit_upload_gate(uuid, text) to authenticated, service_role;
grant execute on function public.service_save_visit_sheet(uuid, jsonb, uuid[]) to authenticated, service_role;
grant execute on function public.service_visit_sheet(uuid) to authenticated, service_role;
