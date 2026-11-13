-- Install follow-on, phase 1. Sub-records can hang off ops.installs.
-- Existing install_jobs rows are left as they are. Do not edit earlier migrations.

alter table ops.installs
  add column needs_customer_email boolean not null default false,
  add column access_sent_at timestamptz,
  add column access_submitted_at timestamptz,
  add column access_media_count integer not null default 0,
  add column last_access_reminder_on date;

alter table ops.access_submissions alter column job_id drop not null;
alter table ops.access_submissions
  add column install_id uuid references ops.installs (id) on delete cascade;
alter table ops.access_submissions
  add constraint access_submissions_target check (job_id is not null or install_id is not null);
create index access_submissions_install_idx on ops.access_submissions (install_id, created_at desc);

alter table ops.risk_assessments alter column job_id drop not null;
alter table ops.risk_assessments
  add column install_id uuid references ops.installs (id) on delete cascade,
  add column concern_file_ids uuid[] not null default '{}';
alter table ops.risk_assessments
  add constraint risk_assessments_target check (job_id is not null or install_id is not null);
create index risk_assessments_install_idx on ops.risk_assessments (install_id);

alter table ops.job_sheets
  add column install_id uuid references ops.installs (id) on delete cascade;
create index job_sheets_install_idx on ops.job_sheets (install_id);

alter table ops.signatures alter column job_id drop not null;
alter table ops.signatures
  add column install_id uuid references ops.installs (id) on delete cascade,
  add column signer_role text check (signer_role is null or signer_role in ('engineer', 'customer'));
alter table ops.signatures
  add constraint signatures_target check (job_id is not null or install_id is not null);
create index signatures_install_idx on ops.signatures (install_id);

alter table ops.sub_quotes alter column job_id drop not null;
alter table ops.sub_quotes
  add column install_id uuid references ops.installs (id) on delete cascade;
alter table ops.sub_quotes
  add constraint sub_quotes_target check (job_id is not null or install_id is not null);
create index sub_quotes_install_idx on ops.sub_quotes (install_id);

-- Paper Installation / Service Form. A token can complete it when there is no staff user.
create table ops.visit_sheets (
  id uuid primary key default gen_random_uuid(),
  install_id uuid not null references ops.installs (id) on delete cascade,
  visit_type text not null check (visit_type in ('install', 'service')),
  contact_name text,
  address text,
  phone text,
  order_no text,
  job_no text,
  service_contract boolean,
  call_out_charge boolean,
  time_on timestamptz,
  time_off timestamptz,
  overnight_stay boolean,
  parking_fee numeric(12,2),
  did_service boolean not null default false,
  did_delivery boolean not null default false,
  did_installation boolean not null default false,
  did_warranty boolean not null default false,
  work_carried_out text,
  location_ok boolean,
  fixing_wall boolean,
  fixing_floor boolean,
  work_ok boolean,
  site_ok boolean,
  engineer_name text,
  vehicle_reg text,
  customer_name text,
  engineer_signature_file_id uuid references core.files (id) on delete set null,
  customer_signature_file_id uuid references core.files (id) on delete set null,
  pdf_file_id uuid references core.files (id) on delete set null,
  completed_by uuid references public.profiles (id) on delete set null,
  token_link_id uuid references core.token_links (id) on delete set null,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (submitted_at is null or completed_by is not null or token_link_id is not null)
);

create index visit_sheets_install_idx on ops.visit_sheets (install_id, created_at desc);

create table ops.visit_sheet_lines (
  id uuid primary key default gen_random_uuid(),
  visit_sheet_id uuid not null references ops.visit_sheets (id) on delete cascade,
  position integer not null default 0,
  code text,
  description text,
  reported_job text
);

create table ops.visit_sheet_parts (
  id uuid primary key default gen_random_uuid(),
  visit_sheet_id uuid not null references ops.visit_sheets (id) on delete cascade,
  position integer not null default 0,
  code text,
  description text,
  qty numeric(12,2) not null default 1 check (qty > 0)
);

create table ops.install_equipment_photos (
  id uuid primary key default gen_random_uuid(),
  install_id uuid not null references ops.installs (id) on delete cascade,
  visit_sheet_id uuid references ops.visit_sheets (id) on delete set null,
  file_id uuid not null references core.files (id) on delete restrict,
  created_at timestamptz not null default now()
);

create index install_equipment_photos_install_idx on ops.install_equipment_photos (install_id);

create table ops.staff_signatures (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  file_id uuid not null references core.files (id) on delete restrict,
  updated_at timestamptz not null default now()
);

create table ops.email_log (
  id uuid primary key default gen_random_uuid(),
  to_address text not null,
  subject text not null,
  template text not null,
  install_id uuid references ops.installs (id) on delete set null,
  provider_id text,
  status text not null check (status in ('logged', 'sent', 'failed', 'redirected')),
  detail text,
  created_at timestamptz not null default now()
);

create index email_log_install_idx on ops.email_log (install_id, created_at desc);

alter table ops.visit_sheets enable row level security;
alter table ops.visit_sheet_lines enable row level security;
alter table ops.visit_sheet_parts enable row level security;
alter table ops.install_equipment_photos enable row level security;
alter table ops.staff_signatures enable row level security;
alter table ops.email_log enable row level security;

revoke all on ops.visit_sheets, ops.visit_sheet_lines, ops.visit_sheet_parts,
  ops.install_equipment_photos, ops.staff_signatures, ops.email_log
  from public, anon, authenticated;
grant all on ops.visit_sheets, ops.visit_sheet_lines, ops.visit_sheet_parts,
  ops.install_equipment_photos, ops.staff_signatures, ops.email_log
  to service_role;

insert into core.settings (key, module_id, value, version, change_reason)
values (
  'installs.access_reminder_days',
  'operations',
  '{"weekly": true, "finalDaysBeforeStart": 7}'::jsonb,
  2,
  'Weekly reminders from booking, then one last note 7 days before the install. Stop once a photo or video is in.'
);

-- ---------------------------------------------------------------------------
-- Stage and access payload. Both sales and operations reads use these.
-- ---------------------------------------------------------------------------

create or replace function ops.install_stage(p_row ops.installs)
returns text
language sql
stable
as $$
  select case
    when p_row.status = 'completed' then 'completed'
    when p_row.access_submitted_at is not null and p_row.access_media_count > 0 then 'ready'
    when p_row.access_sent_at is not null then 'awaiting_access'
    else 'booked'
  end;
$$;

comment on function ops.install_stage(ops.installs) is
  'quoting is reserved for subcontractor quotes. This phase returns booked, awaiting_access, ready, or completed.';

create or replace function ops.install_access_json(p_id uuid)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'sentAt', i.access_sent_at,
    'submittedAt', i.access_submitted_at,
    'needsCustomerEmail', i.needs_customer_email,
    'mediaCount', i.access_media_count,
    'answers', (
      select a.answers
      from ops.access_submissions a
      where a.install_id = i.id
      order by a.created_at desc
      limit 1
    ),
    'media', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', f.id,
        'bucket', f.bucket,
        'path', f.storage_path,
        'mime', f.mime_type,
        'kind', f.kind
      ) order by f.created_at)
      from ops.access_submissions a
      cross join lateral unnest(a.media_file_ids) as mid(file_id)
      join core.files f on f.id = mid.file_id
      where a.install_id = i.id
    ), '[]'::jsonb)
  )
  from ops.installs i
  where i.id = p_id;
$$;

create or replace function ops.install_span(p_row ops.installs)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'id', p_row.id,
    'orderNumber', p_row.order_number,
    'goodsNet', p_row.goods_net,
    'installPrice', p_row.install_price,
    'warrantyOption', p_row.warranty_option,
    'warrantyPrice', p_row.warranty_price,
    'startOn', p_row.start_on,
    'endOn', p_row.end_on,
    'customerName', p_row.customer_name,
    'contactName', p_row.contact_name,
    'contactEmail', p_row.contact_email,
    'contactPhone', p_row.contact_phone,
    'siteAddress', p_row.site_address,
    'status', p_row.status,
    'stage', ops.install_stage(p_row),
    'needsCustomerEmail', p_row.needs_customer_email,
    'bookingRepId', p_row.booking_rep_id,
    'bookingRepName', (select full_name from public.profiles where id = p_row.booking_rep_id),
    'proposalPath', coalesce(p_row.proposal_path, (select proposal_path from ops.service_quotes where id = p_row.service_quote_id)),
    'serviceQuoteId', p_row.service_quote_id,
    'access', ops.install_access_json(p_row.id)
  );
$$;

create or replace function ops.notify_install(p_install uuid, p_title text, p_body text)
returns void
language plpgsql
security definer
set search_path = ops, core, public
as $$
begin
  insert into core.notifications (user_id, title, body, kind, channel, link, entity_schema, entity_table, entity_id)
  select people.id, p_title, p_body, 'access_form', 'in_app',
    case when people.ops then '/operations/installs/' || p_install::text else '/sales/installs/' || p_install::text end,
    'ops', 'installs', p_install
  from (
    select distinct on (id) id, ops
    from (
      select i.booking_rep_id as id, false as ops
      from ops.installs i
      where i.id = p_install
      union all
      select m.profile_id, true
      from public.module_access m
      join public.profiles p on p.id = m.profile_id
      where m.module_id = 'operations' and m.enabled and p.is_active and p.access_granted
    ) audience
    where id is not null
    order by id, ops desc
  ) people;
end;
$$;

create or replace function public.install_access_preview(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ops, core, public
as $$
declare
  v_token jsonb;
  v_install ops.installs%rowtype;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'app: You cannot open that form.';
  end if;
  v_token := public.orbit_resolve_token(p_token_hash);
  if v_token is null or v_token->>'purpose' is distinct from 'access_form' or v_token->>'entity_table' is distinct from 'installs' then
    return null;
  end if;
  select * into v_install from ops.installs where id = (v_token->>'entity_id')::uuid;
  if v_install.id is null then
    return null;
  end if;
  return jsonb_build_object(
    'install_id', v_install.id,
    'customer_name', v_install.customer_name,
    'site_address', v_install.site_address,
    'submitted', v_install.access_submitted_at is not null,
    'media_count', v_install.access_media_count
  );
end;
$$;

create or replace function public.install_save_access(
  p_token_hash text,
  p_answers jsonb,
  p_media_ids uuid[],
  p_accepted_name text,
  p_user_agent text
)
returns jsonb
language plpgsql
security definer
set search_path = ops, core, public
as $$
declare
  v_token jsonb;
  v_install uuid;
  v_existing ops.access_submissions%rowtype;
  v_media uuid[] := coalesce(p_media_ids, '{}');
  v_name text := nullif(btrim(coalesce(p_accepted_name, '')), '');
  v_first boolean := false;
  v_added integer := coalesce(array_length(v_media, 1), 0);
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'app: You cannot submit that form.';
  end if;
  v_token := public.orbit_resolve_token(p_token_hash);
  if v_token is null or v_token->>'purpose' is distinct from 'access_form' or v_token->>'entity_table' is distinct from 'installs' then
    raise exception 'app: That link is not valid.';
  end if;
  v_install := (v_token->>'entity_id')::uuid;
  select * into v_existing
  from ops.access_submissions
  where install_id = v_install
  order by created_at desc
  limit 1;

  if v_existing.id is null then
    if v_name is null then
      raise exception 'app: Add your name.';
    end if;
    insert into ops.access_submissions (
      install_id, answers, media_file_ids, accepted_at, accepted_by_name, accepted_user_agent, submitted_by
    ) values (
      v_install,
      coalesce(p_answers, '{}'::jsonb),
      v_media,
      now(),
      v_name,
      left(coalesce(p_user_agent, ''), 400),
      'customer'
    );
    v_first := true;
    update ops.installs
    set access_submitted_at = coalesce(access_submitted_at, now()),
        access_media_count = access_media_count + v_added
    where id = v_install;
  else
    update ops.access_submissions
    set answers = case when p_answers is null then answers else p_answers end,
        media_file_ids = media_file_ids || v_media,
        accepted_by_name = coalesce(v_name, accepted_by_name)
    where id = v_existing.id;
    update ops.installs
    set access_submitted_at = coalesce(access_submitted_at, case when v_name is not null then now() else null end),
        access_media_count = access_media_count + v_added
    where id = v_install;
  end if;

  if v_first then
    perform ops.notify_install(v_install, 'Access form received', 'The customer sent the site access form.');
  elsif v_added > 0 then
    perform ops.notify_install(v_install, 'Access photos added', 'The customer added photos or videos to the access form.');
  end if;

  return jsonb_build_object('installId', v_install, 'firstSubmit', v_first, 'mediaAdded', v_added);
end;
$$;

create or replace function public.install_revoke_access_links(p_install uuid)
returns void
language plpgsql
security definer
set search_path = ops, core, public
as $$
begin
  if coalesce(auth.role(), '') is distinct from 'service_role'
     and not public.workspace_can('sales', 'edit')
     and not public.workspace_can('operations', 'edit') then
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

create or replace function public.install_mark_access_sent(p_install uuid, p_needs_email boolean)
returns void
language plpgsql
security definer
set search_path = ops, public
as $$
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'app: You cannot update that install.';
  end if;
  update ops.installs
  set needs_customer_email = p_needs_email,
      access_sent_at = case when p_needs_email then null else coalesce(access_sent_at, now()) end
  where id = p_install;
  if p_needs_email then
    perform ops.notify_install(
      p_install,
      'Customer email needed',
      'This install has no customer email, so the access form has not been sent.'
    );
  end if;
end;
$$;

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

create or replace function public.install_save_visit_sheet(p_install uuid, p_sheet jsonb, p_token_hash text default null)
returns uuid
language plpgsql
security definer
set search_path = ops, core, public
as $$
declare
  v_id uuid;
  v_token jsonb;
  v_token_id uuid;
  v_user uuid;
  v_type text := coalesce(p_sheet->>'visitType', 'install');
begin
  if v_type not in ('install', 'service') then
    raise exception 'app: Choose install or service.';
  end if;
  if p_token_hash is not null then
    if coalesce(auth.role(), '') is distinct from 'service_role' then
      raise exception 'app: You cannot save that job sheet.';
    end if;
    v_token := public.orbit_resolve_token(p_token_hash);
    if v_token is null or v_token->>'purpose' is distinct from 'subcontractor_job' or (v_token->>'entity_id')::uuid is distinct from p_install then
      raise exception 'app: That link is not valid.';
    end if;
    select id into v_token_id from core.token_links where token_hash = decode(p_token_hash, 'hex');
  else
    if not (public.workspace_can('operations', 'edit') or public.workspace_can('sales', 'edit')) then
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
    completed_by, token_link_id, submitted_at
  ) values (
    p_install, v_type, p_sheet->>'contactName', p_sheet->>'address', p_sheet->>'phone',
    p_sheet->>'orderNo', p_sheet->>'jobNo',
    nullif(p_sheet->>'serviceContract', '')::boolean, nullif(p_sheet->>'callOutCharge', '')::boolean,
    nullif(p_sheet->>'timeOn', '')::timestamptz, nullif(p_sheet->>'timeOff', '')::timestamptz,
    nullif(p_sheet->>'overnightStay', '')::boolean, nullif(p_sheet->>'parkingFee', '')::numeric,
    coalesce(nullif(p_sheet->>'service', '')::boolean, false), coalesce(nullif(p_sheet->>'delivery', '')::boolean, false),
    coalesce(nullif(p_sheet->>'installation', '')::boolean, false), coalesce(nullif(p_sheet->>'warranty', '')::boolean, false),
    p_sheet->>'workCarriedOut',
    nullif(p_sheet->>'locationOk', '')::boolean, nullif(p_sheet->>'fixingWall', '')::boolean, nullif(p_sheet->>'fixingFloor', '')::boolean,
    nullif(p_sheet->>'workOk', '')::boolean, nullif(p_sheet->>'siteOk', '')::boolean,
    p_sheet->>'engineerName', p_sheet->>'vehicleReg', p_sheet->>'customerName',
    nullif(p_sheet->>'engineerSignatureFileId', '')::uuid,
    nullif(p_sheet->>'customerSignatureFileId', '')::uuid,
    nullif(p_sheet->>'pdfFileId', '')::uuid,
    v_user, v_token_id, now()
  )
  returning id into v_id;

  insert into ops.visit_sheet_lines (visit_sheet_id, position, code, description, reported_job)
  select v_id, ordinality::integer, item->>'code', item->>'description', item->>'reportedJob'
  from jsonb_array_elements(coalesce(p_sheet->'lines', '[]'::jsonb)) with ordinality as listed(item, ordinality);

  insert into ops.visit_sheet_parts (visit_sheet_id, position, code, description, qty)
  select v_id, ordinality::integer, item->>'code', item->>'description', coalesce(nullif(item->>'qty', '')::numeric, 1)
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
  if not public.workspace_can('operations', 'edit') then
    raise exception 'app: You cannot save that risk assessment.';
  end if;
  insert into ops.risk_assessments (install_id, answers, concern_file_ids, completed_by)
  values (p_install, coalesce(p_answers, '{}'::jsonb), coalesce(p_concern_file_ids, '{}'), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.install_save_staff_signature(p_file_id uuid)
returns void
language plpgsql
security definer
set search_path = ops, public
as $$
begin
  if auth.uid() is null then
    raise exception 'app: Sign in to save a signature.';
  end if;
  insert into ops.staff_signatures (profile_id, file_id)
  values (auth.uid(), p_file_id)
  on conflict (profile_id) do update set file_id = excluded.file_id, updated_at = now();
end;
$$;

create or replace function public.email_record(
  p_to text,
  p_subject text,
  p_template text,
  p_install uuid,
  p_provider_id text,
  p_status text,
  p_detail text
)
returns uuid
language plpgsql
security definer
set search_path = ops, public
as $$
declare
  v_id uuid;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'app: You cannot write the email log.';
  end if;
  insert into ops.email_log (to_address, subject, template, install_id, provider_id, status, detail)
  values (p_to, p_subject, p_template, p_install, p_provider_id, p_status, p_detail)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.install_access_reminder_queue()
returns jsonb
language plpgsql
stable
security definer
set search_path = ops, core, public
as $$
declare
  v_settings jsonb;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'app: You cannot read reminder candidates.';
  end if;
  select value into v_settings
  from core.settings
  where key = 'installs.access_reminder_days'
  order by version desc
  limit 1;
  return jsonb_build_object(
    'settings', coalesce(v_settings, '{"weekly": true, "finalDaysBeforeStart": 7}'::jsonb),
    'installs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id,
        'email', i.contact_email,
        'bookedOn', i.created_at::date,
        'startOn', i.start_on,
        'endOn', i.end_on,
        'submitted', i.access_submitted_at is not null,
        'mediaCount', i.access_media_count,
        'lastReminderOn', i.last_access_reminder_on
      ))
      from ops.installs i
      where i.status not in ('cancelled', 'completed')
        and i.contact_email is not null
        and i.access_sent_at is not null
        and i.start_on >= current_date
        and not (i.access_submitted_at is not null and i.access_media_count > 0)
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.install_mark_reminder_sent(p_install uuid, p_day date)
returns void
language plpgsql
security definer
set search_path = ops, public
as $$
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'app: You cannot update that install.';
  end if;
  update ops.installs set last_access_reminder_on = p_day where id = p_install;
end;
$$;

revoke all on function ops.install_stage(ops.installs) from public, anon, authenticated;
revoke all on function ops.install_access_json(uuid) from public, anon, authenticated;
revoke all on function ops.notify_install(uuid, text, text) from public, anon, authenticated;

revoke all on function public.install_access_preview(text) from public, anon;
revoke all on function public.install_save_access(text, jsonb, uuid[], text, text) from public, anon;
revoke all on function public.install_revoke_access_links(uuid) from public, anon;
revoke all on function public.install_mark_access_sent(uuid, boolean) from public, anon;
revoke all on function public.install_set_contact_email(uuid, text) from public, anon;
revoke all on function public.install_save_visit_sheet(uuid, jsonb, text) from public, anon;
revoke all on function public.install_save_risk(uuid, jsonb, uuid[]) from public, anon;
revoke all on function public.install_save_staff_signature(uuid) from public, anon;
revoke all on function public.email_record(text, text, text, uuid, text, text, text) from public, anon;
revoke all on function public.install_access_reminder_queue() from public, anon;
revoke all on function public.install_mark_reminder_sent(uuid, date) from public, anon;

grant execute on function public.install_access_preview(text) to service_role;
grant execute on function public.install_save_access(text, jsonb, uuid[], text, text) to service_role;
grant execute on function public.install_revoke_access_links(uuid) to authenticated, service_role;
grant execute on function public.install_mark_access_sent(uuid, boolean) to service_role;
grant execute on function public.install_set_contact_email(uuid, text) to authenticated, service_role;
grant execute on function public.install_save_visit_sheet(uuid, jsonb, text) to authenticated, service_role;
grant execute on function public.install_save_risk(uuid, jsonb, uuid[]) to authenticated, service_role;
grant execute on function public.install_save_staff_signature(uuid) to authenticated, service_role;
grant execute on function public.email_record(text, text, text, uuid, text, text, text) to service_role;
grant execute on function public.install_access_reminder_queue() to service_role;
grant execute on function public.install_mark_reminder_sent(uuid, date) to service_role;
