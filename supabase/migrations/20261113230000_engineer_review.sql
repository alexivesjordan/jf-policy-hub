-- Review fixes for the engineer visit. New file only.
-- Field engineers are refused from office install functions.
-- Linking a person to a resource is an admin action. Name matching is gone.

-- The old risk save accepts any file id. The app uses install_save_visit_risk.
revoke all on function public.install_save_risk(uuid, jsonb, uuid[]) from public, anon, authenticated, service_role;
drop function public.install_save_risk(uuid, jsonb, uuid[]);

-- Stop the name-based claim. Existing callers become a no-op.
create or replace function public.install_claim_engineer()
returns uuid
language plpgsql
security definer
set search_path = ops, public
as $$
begin
  return null;
end;
$$;

revoke all on function public.install_claim_engineer() from public, anon, authenticated;
grant execute on function public.install_claim_engineer() to service_role;

create or replace function ops.install_file_ok(p_install uuid, p_file uuid, p_bucket text, p_kinds text[])
returns boolean
language sql
stable
security definer
set search_path = ops, core, public
as $$
  select exists (
    select 1
    from core.files f
    where f.id = p_file
      and f.entity_id = p_install
      and f.bucket = p_bucket
      and f.kind = any (p_kinds)
  );
$$;

revoke all on function ops.install_file_ok(uuid, uuid, text, text[]) from public, anon, authenticated;

alter table ops.visit_sheet_lines add column qty numeric(12,2);

-- ---------------------------------------------------------------------------
-- Office functions. A field engineer is refused even on their own job.
-- ---------------------------------------------------------------------------

create or replace function public.install_set_contact_email(p_install uuid, p_email text)
returns void
language plpgsql
security definer
set search_path = ops, public
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_row ops.installs%rowtype;
begin
  if ops.is_field_engineer() then
    raise exception 'app: You cannot update that install.';
  end if;
  if not (public.workspace_can('sales', 'edit') or public.workspace_can('operations', 'edit')) then
    raise exception 'app: You cannot update that install.';
  end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'app: Enter an email address.';
  end if;
  select * into v_row from ops.installs where id = p_install;
  if v_row.id is null then
    raise exception 'app: That install was not found.';
  end if;
  if v_row.booking_rep_id is distinct from auth.uid()
     and not public.workspace_is_admin()
     and not public.workspace_can('operations', 'edit') then
    raise exception 'app: You cannot update that install.';
  end if;
  update ops.installs set contact_email = v_email where id = p_install;
end;
$$;

create or replace function public.install_save_quote(p_order_number text, p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ops, public
as $$
declare
  v_id uuid;
begin
  if ops.is_field_engineer() then
    raise exception 'app: You cannot save an install quote.';
  end if;
  if not (public.workspace_can('sales', 'edit') or public.workspace_can('operations', 'edit')) then
    raise exception 'app: You cannot save an install quote.';
  end if;
  if nullif(btrim(coalesce(p_order_number, '')), '') is null then
    raise exception 'app: Enter an order number.';
  end if;
  insert into ops.install_quotes (created_by, order_number, payload)
  values (auth.uid(), btrim(p_order_number), coalesce(p_payload, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.install_book(p_quote_id uuid, p_start date, p_warranty text)
returns jsonb
language plpgsql
security definer
set search_path = ops, public
as $$
declare
  v_quote ops.install_quotes%rowtype;
  v_payload jsonb;
  v_weekends boolean := false;
  v_total integer;
  v_days date[];
  v_ids uuid[];
  v_install uuid;
  v_end date;
  v_option text := nullif(p_warranty, 'none');
  v_price numeric;
  v_resources jsonb;
  v_requirements jsonb;
begin
  if ops.is_field_engineer() then
    raise exception 'app: You cannot book an install.';
  end if;
  if not (public.workspace_can('sales', 'edit') or public.workspace_can('operations', 'edit')) then
    raise exception 'app: You cannot book an install.';
  end if;
  select * into v_quote from ops.install_quotes where id = p_quote_id for update;
  if v_quote.id is null then
    raise exception 'app: Price the order before booking.';
  end if;
  if v_quote.install_id is not null then
    raise exception 'app: That order is already booked.';
  end if;
  if v_quote.created_by is distinct from auth.uid() and not public.workspace_is_admin() and not public.workspace_can('operations', 'edit') then
    raise exception 'app: You cannot book that quote.';
  end if;
  v_payload := v_quote.payload;
  v_total := greatest(coalesce((v_payload->>'totalDays')::integer, 1), 1);
  select coalesce(array_agg(day order by day), '{}') into v_days
  from ops.install_working_days(p_start, v_total, v_weekends) as day;
  if coalesce(array_length(v_days, 1), 0) < v_total or v_days[1] is distinct from p_start then
    raise exception 'app: Choose a weekday start date.';
  end if;
  v_requirements := coalesce(v_payload->'requirements', '{}'::jsonb);
  v_ids := ops.pick_install_resources(
    v_days,
    greatest(coalesce((v_requirements->>'installers')::integer, 1), 1),
    greatest(coalesce((v_requirements->>'licensedDrivers')::integer, 0), 0),
    coalesce(v_requirements->>'vanSize', 'small'),
    greatest(coalesce((v_requirements->>'vanCount')::integer, 1), 1),
    coalesce((v_requirements->>'stairClimber')::boolean, false)
  );
  if v_ids is null then
    raise exception 'app: Those engineers or vans are no longer free. Choose another start date.';
  end if;
  if v_option is not null and v_option not in ('annual', 'twice_yearly', 'extension', 'annual_bundle', 'twice_yearly_bundle') then
    raise exception 'app: Choose a warranty option from the priced quote.';
  end if;
  v_price := case v_option
    when 'annual' then (v_payload #>> '{warranty,annual}')::numeric
    when 'twice_yearly' then (v_payload #>> '{warranty,twice}')::numeric
    when 'extension' then (v_payload #>> '{warranty,extension}')::numeric
    when 'annual_bundle' then (v_payload #>> '{warranty,annualBundle}')::numeric
    when 'twice_yearly_bundle' then (v_payload #>> '{warranty,twiceBundle}')::numeric
    else null
  end;
  if v_option is not null and v_price is null then
    raise exception 'app: That warranty option was not priced.';
  end if;
  v_end := v_days[array_length(v_days, 1)];
  insert into ops.installs (
    quote_id, order_number, goods_net, install_price, warranty_option, warranty_price,
    start_on, end_on, customer_name, contact_name, contact_email, contact_phone, site_address,
    status, booking_rep_id, service_quote_id, proposal_path,
    flags, hq_build, site_install, crew, van_size, van_count, lines, cin7_sale_id, cin7_customer_id
  ) values (
    v_quote.id, v_quote.order_number,
    (v_payload->>'goodsNet')::numeric, (v_payload->>'installPrice')::numeric,
    v_option, v_price, p_start, v_end,
    coalesce(v_payload->>'customerName', ''),
    v_payload->>'contactName', v_payload->>'contactEmail', v_payload->>'contactPhone', v_payload->>'siteAddress',
    'booked', auth.uid(),
    nullif(v_payload->>'serviceQuoteId', '')::uuid, v_payload->>'proposalPath',
    coalesce(v_payload->'flags', '[]'::jsonb),
    coalesce(v_payload->'hqBuild', '{}'::jsonb),
    coalesce(v_payload->'siteInstall', '{}'::jsonb),
    greatest(coalesce((v_requirements->>'installers')::integer, 1), 1),
    coalesce(v_requirements->>'vanSize', 'small'),
    greatest(coalesce((v_requirements->>'vanCount')::integer, 1), 1),
    coalesce(v_payload->'lines', '[]'::jsonb),
    v_payload->>'cin7SaleId', v_payload->>'cin7CustomerId'
  ) returning id into v_install;
  v_resources := ops.hold_install_resources(v_install, v_ids, v_days);
  update ops.installs set resources = v_resources where id = v_install;
  update ops.install_quotes set install_id = v_install where id = v_quote.id;
  return public.install_read(v_install);
end;
$$;

create or replace function public.install_available_starts(p_quote_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ops, public
as $$
declare
  v_quote ops.install_quotes%rowtype;
  v_payload jsonb;
  v_total integer;
  v_weekends boolean := false;
  v_day date;
  v_days date[];
  v_found date[] := '{}';
  v_requirements jsonb;
begin
  if ops.is_field_engineer() then
    raise exception 'app: You cannot see install dates.';
  end if;
  if not (public.workspace_can('sales', 'view') or public.workspace_can('operations', 'view')) then
    raise exception 'app: You cannot see install dates.';
  end if;
  select * into v_quote from ops.install_quotes where id = p_quote_id;
  if v_quote.id is null then
    raise exception 'app: Price the order before booking.';
  end if;
  if v_quote.created_by is distinct from auth.uid() and not public.workspace_is_admin() and not public.workspace_can('operations', 'view') then
    raise exception 'app: You cannot see dates for that quote.';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to > p_from + 120 then
    raise exception 'app: Choose a shorter date range.';
  end if;
  v_payload := v_quote.payload;
  v_total := greatest(coalesce((v_payload->>'totalDays')::integer, 1), 1);
  v_requirements := coalesce(v_payload->'requirements', '{}'::jsonb);
  v_day := p_from;
  while v_day <= p_to loop
    if v_weekends or extract(isodow from v_day) < 6 then
      select coalesce(array_agg(day order by day), '{}') into v_days
      from ops.install_working_days(v_day, v_total, v_weekends) as day;
      if v_days[1] is not distinct from v_day and ops.pick_install_resources(
        v_days,
        greatest(coalesce((v_requirements->>'installers')::integer, 1), 1),
        greatest(coalesce((v_requirements->>'licensedDrivers')::integer, 0), 0),
        coalesce(v_requirements->>'vanSize', 'small'),
        greatest(coalesce((v_requirements->>'vanCount')::integer, 1), 1),
        coalesce((v_requirements->>'stairClimber')::boolean, false)
      ) is not null then
        v_found := v_found || v_day;
      end if;
    end if;
    v_day := v_day + 1;
  end loop;
  return to_jsonb(v_found);
end;
$$;

create or replace function public.install_revoke_access_links(p_install uuid)
returns void
language plpgsql
security definer
set search_path = ops, core, public
as $$
begin
  if ops.is_field_engineer() then
    raise exception 'app: You cannot replace that link.';
  end if;
  if not ops.install_actor_allowed(p_install) then
    raise exception 'app: You cannot replace that link.';
  end if;
  update core.token_links
  set revoked_at = coalesce(revoked_at, now())
  where purpose = 'access_form'
    and entity_schema = 'ops'
    and entity_table = 'installs'
    and entity_id = p_install
    and revoked_at is null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Visit writes. Auth first. File ids must belong to this job.
-- ---------------------------------------------------------------------------

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
  if coalesce(nullif(p_sheet->>'ladderCheck', '')::boolean, false) is not true then
    raise exception 'app: Confirm the ladder check.';
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
    v_engineer, v_customer, v_pdf,
    v_user, v_token_id, now(),
    case when coalesce(p_sheet->>'sheetOn', '') ~ '^\d{4}-\d{2}-\d{2}$' then (p_sheet->>'sheetOn')::date else null end,
    case when coalesce(p_sheet->>'returnedOn', '') ~ '^\d{4}-\d{2}-\d{2}$' then (p_sheet->>'returnedOn')::date else null end,
    true
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
  foreach v_key in array ARRAY['accessClear', 'floorSuitable', 'powerSafe', 'handlingPlanned', 'peopleBriefed', 'ladderCheck']
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

create or replace function public.install_concern_files(p_install uuid, p_token_hash text default null)
returns jsonb
language plpgsql
security definer
set search_path = ops, core, public
as $$
begin
  if p_token_hash is not null then
    perform ops.assert_job_token(p_install, p_token_hash);
  elsif not ops.visit_can(p_install) then
    raise exception 'app: You cannot open that job.';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', f.id, 'bucket', f.bucket, 'path', f.storage_path) order by f.created_at)
    from ops.risk_assessments ra
    cross join lateral unnest(ra.concern_file_ids) as mid(file_id)
    join core.files f on f.id = mid.file_id
      and f.entity_id = p_install
      and f.bucket = 'job-sheets'
      and f.kind = 'concern'
    where ra.id = (select id from ops.risk_assessments where install_id = p_install order by completed_at desc limit 1)
  ), '[]'::jsonb);
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
  if p_token_hash is not null then
    perform ops.assert_job_token(p_install, p_token_hash);
  elsif not ops.visit_can(p_install) then
    raise exception 'app: You cannot save that job sheet.';
  end if;
  if coalesce(array_length(p_photo_ids, 1), 0) < 1 then
    raise exception 'app: Add a photo of the equipment.';
  end if;
  if not exists (select 1 from ops.risk_assessments where install_id = p_install) then
    raise exception 'app: Save the risk assessment before the job sheet.';
  end if;
  if exists (
    select 1 from unnest(p_photo_ids) as fid
    where not ops.install_file_ok(p_install, fid, 'job-sheets', array['equipment'])
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
    'visit_sheet', 'in_app',
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

create or replace function public.install_visit_upload_gate(p_install uuid, p_token_hash text, p_kind text)
returns void
language plpgsql
security definer
set search_path = ops, core, public
as $$
begin
  if p_kind is null or p_kind not in ('concern', 'equipment') then
    raise exception 'app: That photo is not allowed.';
  end if;
  if p_token_hash is not null then
    perform ops.assert_job_token(p_install, p_token_hash);
  elsif not ops.visit_can(p_install) then
    raise exception 'app: You cannot open that job.';
  end if;
  if exists (select 1 from ops.visit_sheets where install_id = p_install and submitted_at is not null) then
    raise exception 'app: This job sheet is already in.';
  end if;
  if (
    select count(*)
    from core.files f
    where f.entity_id = p_install
      and f.bucket = 'job-sheets'
      and f.kind in ('concern', 'equipment')
  ) >= 40 then
    raise exception 'app: That job already has enough photos.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Prices stay off the field engineer's read of the office install.
-- ---------------------------------------------------------------------------

create or replace function ops.engineer_install_view(p_row jsonb)
returns jsonb
language sql
immutable
as $$
  select case
    when p_row is null then null
    else jsonb_set(
      p_row - 'goodsNet' - 'installPrice' - 'warrantyPrice' - 'cin7SaleId' - 'cin7CustomerId',
      '{lines}',
      coalesce((
        select jsonb_agg(line - 'lineNet' - 'line_net' - 'goodsNet' - 'installPrice')
        from jsonb_array_elements(
          case when jsonb_typeof(p_row->'lines') = 'array' then p_row->'lines' else '[]'::jsonb end
        ) line
      ), '[]'::jsonb)
    )
  end;
$$;

revoke all on function ops.engineer_install_view(jsonb) from public, anon, authenticated;

create or replace function public.install_calendar(p_from date, p_to date, p_mine boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ops, public
as $$
declare
  v_field boolean := ops.is_field_engineer() and not public.workspace_is_admin();
  v_office boolean := public.workspace_can('operations', 'view') or public.workspace_is_admin();
  v_sales boolean := v_office or v_field or public.workspace_can('sales', 'view');
begin
  if not v_sales then
    raise exception 'app: You cannot see installs.';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'app: Choose a date range.';
  end if;
  return coalesce((
    select jsonb_agg(
      case when v_field then ops.engineer_install_view(span.item) else span.item end
      order by i.start_on, i.order_number
    )
    from ops.installs i
    cross join lateral (
      select ops.install_span(i) || case when v_office then jsonb_build_object(
        'flags', i.flags, 'hqBuild', i.hq_build, 'siteInstall', i.site_install, 'crew', i.crew,
        'vans', jsonb_build_object('size', i.van_size, 'count', i.van_count),
        'resources', i.resources, 'lines', i.lines, 'cin7SaleId', i.cin7_sale_id, 'cin7CustomerId', i.cin7_customer_id
      ) else '{}'::jsonb end as item
    ) span
    where i.status <> 'cancelled'
      and i.start_on <= p_to
      and i.end_on >= p_from
      and (not coalesce(p_mine, false) or i.booking_rep_id = auth.uid())
      and (not v_field or ops.install_assigned(i.id, auth.uid()))
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
  v_field boolean := ops.is_field_engineer() and not public.workspace_is_admin();
  v_office boolean := public.workspace_can('operations', 'view') or public.workspace_is_admin();
  v_json jsonb;
begin
  if not (v_office or v_field or public.workspace_can('sales', 'view')) then
    raise exception 'app: You cannot see that install.';
  end if;
  if v_field and not ops.install_assigned(p_id, auth.uid()) then
    raise exception 'app: You cannot see that install.';
  end if;
  select * into v_row from ops.installs where id = p_id;
  if v_row.id is null then
    raise exception 'app: That install was not found.';
  end if;
  v_json := ops.install_span(v_row) || case when v_office then jsonb_build_object(
    'flags', v_row.flags, 'hqBuild', v_row.hq_build, 'siteInstall', v_row.site_install, 'crew', v_row.crew,
    'vans', jsonb_build_object('size', v_row.van_size, 'count', v_row.van_count),
    'resources', v_row.resources, 'lines', v_row.lines, 'cin7SaleId', v_row.cin7_sale_id, 'cin7CustomerId', v_row.cin7_customer_id
  ) else '{}'::jsonb end;
  if v_field then
    v_json := ops.engineer_install_view(v_json);
  end if;
  return v_json;
end;
$$;

revoke all on function public.install_calendar(date, date, boolean) from public, anon;
revoke all on function public.install_read(uuid) from public, anon;
grant execute on function public.install_calendar(date, date, boolean) to authenticated, service_role;
grant execute on function public.install_read(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Admin links a person to a field resource. Documents stay read-only for engineers.
-- ---------------------------------------------------------------------------

create or replace function public.install_set_field_resource(p_profile uuid, p_resource uuid)
returns void
language plpgsql
security definer
set search_path = ops, public
as $$
begin
  if ops.is_field_engineer() and not public.workspace_is_admin() then
    raise exception 'app: You cannot change that link.';
  end if;
  if not public.workspace_is_admin() then
    raise exception 'app: You cannot change that link.';
  end if;
  if p_profile is null or not exists (select 1 from public.profiles where id = p_profile) then
    raise exception 'app: That person was not found.';
  end if;
  update ops.resources
  set profile_id = null
  where profile_id = p_profile
    and resource_type in ('installer', 'helper')
    and (p_resource is null or id is distinct from p_resource);
  if p_resource is null then
    return;
  end if;
  if not exists (
    select 1 from ops.resources
    where id = p_resource and resource_type in ('installer', 'helper') and status = 'active'
  ) then
    raise exception 'app: Choose a field engineer.';
  end if;
  update ops.resources set profile_id = p_profile where id = p_resource;
end;
$$;

create or replace function public.install_field_resources()
returns jsonb
language plpgsql
security definer
set search_path = ops, public
as $$
begin
  if ops.is_field_engineer() and not public.workspace_is_admin() then
    raise exception 'app: You cannot view engineer logins.';
  end if;
  if not public.workspace_is_admin() then
    raise exception 'app: You cannot view engineer logins.';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id,
      'name', r.name,
      'profileId', r.profile_id
    ) order by r.name)
    from ops.resources r
    where r.resource_type in ('installer', 'helper')
      and r.status = 'active'
  ), '[]'::jsonb);
end;
$$;

create or replace function public.install_field_role()
returns text
language sql
stable
security definer
set search_path = ops, public
as $$
  select case
    when auth.uid() is null then 'none'
    when public.workspace_is_admin() then 'admin'
    when ops.is_field_engineer() then 'engineer'
    when public.install_sees_all() then 'ops'
    else 'none'
  end;
$$;

create or replace function public.install_engineer_links()
returns jsonb
language plpgsql
security definer
set search_path = ops, public
as $$
begin
  if ops.is_field_engineer() then
    raise exception 'app: You cannot view engineer logins.';
  end if;
  if not public.install_sees_all() then
    raise exception 'app: You cannot view engineer logins.';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('name', r.name, 'linked', r.profile_id is not null, 'profileName', p.full_name) order by r.name)
    from ops.resources r
    left join public.profiles p on p.id = r.profile_id
    where r.resource_type in ('installer', 'helper')
      and r.status = 'active'
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
  if ops.is_field_engineer() then
    raise exception 'app: You cannot update those documents.';
  end if;
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

revoke all on function public.install_visit_upload_gate(uuid, text, text) from public, anon;
revoke all on function public.install_set_field_resource(uuid, uuid) from public, anon;
revoke all on function public.install_field_resources() from public, anon;
revoke all on function public.install_field_role() from public, anon;
grant execute on function public.install_visit_upload_gate(uuid, text, text) to authenticated, service_role;
grant execute on function public.install_set_field_resource(uuid, uuid) to authenticated, service_role;
grant execute on function public.install_field_resources() to authenticated, service_role;
grant execute on function public.install_field_role() to authenticated, service_role;
