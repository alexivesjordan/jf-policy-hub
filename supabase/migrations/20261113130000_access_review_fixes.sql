-- Review fixes for the install access form. New file only: the first follow-on migration is already on TEST.

update storage.buckets
set file_size_limit = 209715200
where id = 'access-media'
  and (file_size_limit is null or file_size_limit < 209715200);

alter table ops.email_log
  add column if not exists token_link_id uuid references core.token_links (id) on delete set null,
  add column if not exists access_path text;

comment on column ops.email_log.access_path is
  'Customer path such as /access/{token}. Service role only. Reminders reuse it. The install page can reissue a fresh link.';

insert into core.settings (key, module_id, value, version, change_reason)
values (
  'installs.access_reminder_days',
  'operations',
  '{"weekly": true, "finalDaysBeforeStart": 7, "backfillMissingLinks": true}'::jsonb,
  3,
  'Catch up a missed reminder day. The first cron issues links for future installs that have an email and no token. Set backfillMissingLinks to false to skip that.'
);

create or replace function ops.install_stage(p_row ops.installs)
returns text
language sql
stable
as $$
  select case
    when p_row.status = 'completed' then 'completed'
    when p_row.access_submitted_at is not null then 'ready'
    when p_row.access_sent_at is not null then 'awaiting_access'
    else 'booked'
  end;
$$;

comment on function ops.install_stage(ops.installs) is
  'quoting is reserved. ready means the form was submitted. Photos and videos stay optional.';

create or replace function ops.install_actor_allowed(p_install uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ops, public
as $$
declare
  v_rep uuid;
begin
  if coalesce(auth.role(), '') = 'service_role' then
    return true;
  end if;
  if public.workspace_is_admin() or public.workspace_can('operations', 'edit') then
    return true;
  end if;
  select booking_rep_id into v_rep from ops.installs where id = p_install;
  return v_rep is not null and v_rep = auth.uid();
end;
$$;

revoke all on function ops.install_actor_allowed(uuid) from public, anon, authenticated;

create or replace function public.install_revoke_access_links(p_install uuid)
returns void
language plpgsql
security definer
set search_path = ops, core, public
as $$
begin
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
    if not ops.install_actor_allowed(p_install) then
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

drop function if exists public.install_mark_access_sent(uuid, boolean);

create function public.install_mark_access_sent(p_install uuid, p_delivered boolean, p_reason text)
returns void
language plpgsql
security definer
set search_path = ops, public
as $$
declare
  v_sent timestamptz;
  v_flagged boolean;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'app: You cannot update that install.';
  end if;
  select access_sent_at, needs_customer_email into v_sent, v_flagged
  from ops.installs where id = p_install;
  if p_delivered then
    update ops.installs
    set access_sent_at = coalesce(access_sent_at, now()),
        needs_customer_email = false
    where id = p_install;
  elsif v_sent is null and not coalesce(v_flagged, false) then
    update ops.installs set needs_customer_email = true where id = p_install;
    perform ops.notify_install(
      p_install,
      case when p_reason = 'missing_email' then 'Customer email needed' else 'Access form not emailed' end,
      case when p_reason = 'missing_email'
        then 'This install has no customer email, so the access form has not been sent.'
        else 'The access form was not emailed. Open the install and copy the link.'
      end
    );
  elsif v_sent is null then
    update ops.installs set needs_customer_email = true where id = p_install;
  end if;
end;
$$;

drop function if exists public.email_record(text, text, text, uuid, text, text, text);

create function public.email_record(
  p_to text,
  p_subject text,
  p_template text,
  p_install uuid,
  p_provider_id text,
  p_status text,
  p_detail text,
  p_token_link uuid default null,
  p_access_path text default null
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
  insert into ops.email_log (to_address, subject, template, install_id, provider_id, status, detail, token_link_id, access_path)
  values (p_to, p_subject, p_template, p_install, p_provider_id, p_status, p_detail, p_token_link, p_access_path)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.install_latest_access_path(p_install uuid)
returns text
language sql
stable
security definer
set search_path = ops, core, public
as $$
  select l.access_path
  from ops.email_log l
  join core.token_links t on t.id = l.token_link_id
  where l.install_id = p_install
    and l.access_path is not null
    and t.purpose = 'access_form'
    and t.revoked_at is null
    and (t.expires_at is null or t.expires_at > now())
    and coalesce(auth.role(), '') = 'service_role'
  order by l.created_at desc
  limit 1;
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
    'settings', coalesce(v_settings, '{"weekly": true, "finalDaysBeforeStart": 7, "backfillMissingLinks": true}'::jsonb),
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
        and i.start_on >= current_date
        and i.access_submitted_at is null
        and exists (
          select 1 from core.token_links t
          where t.purpose = 'access_form'
            and t.entity_schema = 'ops'
            and t.entity_table = 'installs'
            and t.entity_id = i.id
            and t.revoked_at is null
            and (t.expires_at is null or t.expires_at > now())
        )
    ), '[]'::jsonb),
    'backfill', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id,
        'email', i.contact_email,
        'endOn', i.end_on
      ))
      from ops.installs i
      where i.status not in ('cancelled', 'completed')
        and i.contact_email is not null
        and i.start_on >= current_date
        and i.access_submitted_at is null
        and not exists (
          select 1 from core.token_links t
          where t.purpose = 'access_form'
            and t.entity_schema = 'ops'
            and t.entity_table = 'installs'
            and t.entity_id = i.id
            and t.revoked_at is null
            and (t.expires_at is null or t.expires_at > now())
        )
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.install_mark_access_sent(uuid, boolean, text) from public, anon;
revoke all on function public.email_record(text, text, text, uuid, text, text, text, uuid, text) from public, anon;
revoke all on function public.install_latest_access_path(uuid) from public, anon, authenticated;

grant execute on function public.install_mark_access_sent(uuid, boolean, text) to service_role;
grant execute on function public.email_record(text, text, text, uuid, text, text, text, uuid, text) to service_role;
grant execute on function public.install_latest_access_path(uuid) to service_role;
