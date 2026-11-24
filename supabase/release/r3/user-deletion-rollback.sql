-- Removes user deletion and the quote/job owner columns.
-- Issued invoices, quotes, and jobs stay. Owners added by this migration are dropped.
-- Apply on TEST only. Do not run this on production without Alex's approval.

drop trigger if exists install_quotes_default_owner on ops.install_quotes;
drop trigger if exists service_quotes_default_owner on ops.service_quotes;
drop trigger if exists install_jobs_default_owner on ops.install_jobs;
drop trigger if exists installs_default_owner on ops.installs;

drop function if exists public.admin_delete_user(uuid);
drop function if exists public.set_record_owner(text, uuid, uuid);
drop function if exists ops.assign_default_owner();

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
    'access', ops.install_access_json(p_row.id),
    'deliveredBy', p_row.delivered_by,
    'subcontractorId', p_row.subcontractor_id,
    'subcontractorName', (select name from ops.subcontractors where id = p_row.subcontractor_id),
    'subcontractorPrice', p_row.subcontractor_price,
    'suggestedDates', to_jsonb(p_row.suggested_dates)
  );
$$;

create or replace function public.workspace_directory()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.workspace_is_admin() then
    raise exception 'app: Only a workspace owner or admin can open this.';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id,
      'email', p.email,
      'first_name', p.first_name,
      'last_name', p.last_name,
      'full_name', p.full_name,
      'role', p.role,
      'workspace_role', p.workspace_role,
      'access_mode', p.access_mode,
      'is_active', p.is_active,
      'teams', coalesce((
        select jsonb_agg(t.name order by t.name)
        from public.workspace_team_members m
        join public.workspace_teams t on t.id = m.team_id
        where m.profile_id = p.id
      ), '[]'::jsonb),
      'effective', jsonb_build_object(
        'people', public.workspace_level(p.id, 'people'),
        'service', public.workspace_level(p.id, 'service'),
        'supply', public.workspace_level(p.id, 'supply'),
        'operations', public.workspace_level(p.id, 'operations'),
        'sales', public.workspace_level(p.id, 'sales'),
        'finance', public.workspace_level(p.id, 'finance')
      )
    ) order by p.last_name, p.first_name, p.email)
    from public.profiles p
  ), '[]'::jsonb);
end;
$$;

create or replace function public.orbit_list_jobs()
returns jsonb
language plpgsql
stable
security definer
set search_path = ops, core, public
as $$
declare
  v_rows jsonb;
begin
  if auth.uid() is null then
    raise exception 'app: You need to be signed in.';
  end if;
  if not public.workspace_can('operations', 'view') then
    raise exception 'app: You do not have the Operations module.';
  end if;
  select coalesce(jsonb_agg(row_data order by created_at desc), '[]'::jsonb)
  into v_rows
  from (
    select
      jsonb_build_object(
        'id', j.id,
        'status', j.status,
        'status_label', coalesce(ws.label, j.status::text),
        'job_type', j.job_type,
        'cin7_number', j.cin7_number,
        'cin7_order_number', j.cin7_order_number,
        'fixture', coalesce(j.cin7_number, '') like 'FIXTURE-%',
        'customer_name', c.name,
        'customer_segment', c.segment,
        'customer_type', c.customer_type,
        'postcode', s.postcode,
        'city', s.city,
        'big_install', j.big_install,
        'hold_reason', j.hold_reason,
        'requested_date', j.requested_date,
        'requested_end', j.requested_end,
        'booked_date', j.booked_date,
        'created_at', j.created_at
      ) as row_data,
      j.created_at
    from ops.install_jobs j
    join ops.customers c on c.id = j.customer_id
    left join ops.sites s on s.id = j.site_id
    left join core.workflow_states ws
      on ws.code = j.status::text
     and ws.workflow_id = (
       select d.id
       from core.workflow_definitions d
       where d.module_id = 'operations'
         and d.name = 'install_job'
     )
    where ops.job_visible(j.id)
    order by j.created_at desc
    limit 100
  ) listed;
  return v_rows;
end;
$$;

create or replace function public.orbit_get_job(p_job_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ops, core, public
as $$
declare
  v_job ops.install_jobs%rowtype;
  v_customer ops.customers%rowtype;
  v_site ops.sites%rowtype;
  v_label text;
  v_quotes jsonb;
  v_show_price boolean;
begin
  if auth.uid() is null then
    raise exception 'app: You need to be signed in.';
  end if;
  if not ops.job_visible(p_job_id) then
    return null;
  end if;
  select * into v_job from ops.install_jobs where id = p_job_id;
  select * into v_customer from ops.customers where id = v_job.customer_id;
  if v_job.site_id is not null then
    select * into v_site from ops.sites where id = v_job.site_id;
  end if;
  select ws.label into v_label
  from core.workflow_states ws
  join core.workflow_definitions d on d.id = ws.workflow_id
  where d.module_id = 'operations'
    and d.name = 'install_job'
    and ws.code = v_job.status::text;
  v_show_price := ops.money_visible(p_job_id) or ops.sales_job_visible(p_job_id);
  if v_show_price then
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', q.id,
        'mode', q.mode,
        'finality', q.finality,
        'customer_price', case when ops.sales_job_visible(p_job_id) or ops.money_visible(p_job_id) then q.customer_price else null end,
        'internal_cost', case when ops.money_visible(p_job_id) then q.internal_cost else null end,
        'created_at', q.created_at
      )
      order by q.created_at desc
    ), '[]'::jsonb)
    into v_quotes
    from ops.quote_versions q
    where q.job_id = p_job_id;
  else
    v_quotes := '[]'::jsonb;
  end if;
  return jsonb_build_object(
    'id', v_job.id,
    'status', v_job.status,
    'status_label', coalesce(v_label, v_job.status::text),
    'job_type', v_job.job_type,
    'cin7_number', v_job.cin7_number,
    'cin7_quote_number', v_job.cin7_quote_number,
    'cin7_order_number', v_job.cin7_order_number,
    'fixture', coalesce(v_job.cin7_number, '') like 'FIXTURE-%',
    'delivered_by', v_job.delivered_by,
    'big_install', v_job.big_install,
    'big_install_triggers', v_job.big_install_triggers,
    'requested_date', v_job.requested_date,
    'booked_date', v_job.booked_date,
    'arrival_window', v_job.arrival_window,
    'hold_reason', v_job.hold_reason,
    'hold_review_date', v_job.hold_review_date,
    'lost_reason', v_job.lost_reason,
    'created_at', v_job.created_at,
    'customer', jsonb_build_object(
      'id', v_customer.id,
      'name', v_customer.name,
      'segment', v_customer.segment,
      'customer_type', v_customer.customer_type,
      'cin7_id', v_customer.cin7_id
    ),
    'site', case
      when v_site.id is null then null
      else jsonb_build_object(
        'id', v_site.id,
        'name', v_site.name,
        'address_line1', v_site.address_line1,
        'city', v_site.city,
        'postcode', v_site.postcode
      )
    end,
    'quote_versions', v_quotes
  );
end;
$$;

alter table ops.install_quotes drop column if exists owner_user_id;
alter table ops.service_quotes drop column if exists owner_user_id;
alter table ops.install_jobs drop column if exists owner_user_id;
alter table ops.installs drop column if exists owner_user_id;

drop function if exists public.owner_name(uuid);

alter table public.profiles drop column if exists deleted_at;
