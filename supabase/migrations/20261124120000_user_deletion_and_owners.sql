-- Soft-delete people, and give quotes and jobs an owner that can be cleared.
-- Deleting a profile row would cascade from auth.users and erase names, so a
-- removed person stays in profiles with deleted_at set. Auth sign-in is banned
-- by the app. A person with no history is hard-deleted by the app instead.

alter table public.profiles
  add column if not exists deleted_at timestamptz;

comment on column public.profiles.deleted_at is
  'Set when an admin removes the person. full_name stays so historical records keep the name.';

create index if not exists profiles_active_idx
  on public.profiles (id)
  where deleted_at is null;

alter table ops.install_quotes
  add column if not exists owner_user_id uuid references public.profiles (id) on delete set null;

alter table ops.service_quotes
  add column if not exists owner_user_id uuid references public.profiles (id) on delete set null;

alter table ops.install_jobs
  add column if not exists owner_user_id uuid references public.profiles (id) on delete set null;

alter table ops.installs
  add column if not exists owner_user_id uuid references public.profiles (id) on delete set null;

update ops.install_quotes
set owner_user_id = created_by
where owner_user_id is null and created_by is not null;

update ops.service_quotes
set owner_user_id = created_by
where owner_user_id is null and created_by is not null;

update ops.installs i
set owner_user_id = coalesce(
  (select q.created_by from ops.install_quotes q where q.id = i.quote_id),
  i.booking_rep_id
)
where i.owner_user_id is null;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'ops'
      and table_name = 'install_jobs'
      and column_name = 'created_by'
  ) then
    execute $fill$
      update ops.install_jobs
      set owner_user_id = coalesce(owner_rep_id, created_by)
      where owner_user_id is null
        and coalesce(owner_rep_id, created_by) is not null
    $fill$;
  else
    update ops.install_jobs j
    set owner_user_id = coalesce(
      j.owner_rep_id,
      (
        select i.owner_user_id
        from ops.installs i
        where i.owner_user_id is not null
          and i.order_number in (j.cin7_order_number, j.cin7_number, j.cin7_quote_number)
        order by i.created_at desc
        limit 1
      )
    )
    where j.owner_user_id is null
      and coalesce(
        j.owner_rep_id,
        (
          select i.owner_user_id
          from ops.installs i
          where i.owner_user_id is not null
            and i.order_number in (j.cin7_order_number, j.cin7_number, j.cin7_quote_number)
          limit 1
        )
      ) is not null;
  end if;
end $$;

create or replace function ops.assign_default_owner()
returns trigger
language plpgsql
as $$
declare
  v_owner uuid;
begin
  if new.owner_user_id is not null then
    return new;
  end if;
  if tg_table_name = 'install_quotes' then
    new.owner_user_id := new.created_by;
  elsif tg_table_name = 'service_quotes' then
    new.owner_user_id := new.created_by;
  elsif tg_table_name = 'install_jobs' then
    v_owner := new.owner_rep_id;
    if v_owner is null and exists (
      select 1
      from information_schema.columns
      where table_schema = 'ops'
        and table_name = 'install_jobs'
        and column_name = 'created_by'
    ) then
      execute 'select ($1).created_by' into v_owner using new;
    end if;
    if v_owner is null then
      select i.owner_user_id into v_owner
      from ops.installs i
      where i.owner_user_id is not null
        and i.order_number in (new.cin7_order_number, new.cin7_number, new.cin7_quote_number)
      order by i.created_at desc
      limit 1;
    end if;
    new.owner_user_id := coalesce(v_owner, auth.uid());
  elsif tg_table_name = 'installs' then
    new.owner_user_id := new.booking_rep_id;
  end if;
  return new;
end;
$$;

drop trigger if exists install_quotes_default_owner on ops.install_quotes;
create trigger install_quotes_default_owner
before insert on ops.install_quotes
for each row execute function ops.assign_default_owner();

drop trigger if exists service_quotes_default_owner on ops.service_quotes;
create trigger service_quotes_default_owner
before insert on ops.service_quotes
for each row execute function ops.assign_default_owner();

drop trigger if exists install_jobs_default_owner on ops.install_jobs;
create trigger install_jobs_default_owner
before insert on ops.install_jobs
for each row execute function ops.assign_default_owner();

drop trigger if exists installs_default_owner on ops.installs;
create trigger installs_default_owner
before insert on ops.installs
for each row execute function ops.assign_default_owner();

create or replace function public.owner_name(p_profile uuid)
returns text
language sql
stable
as $$
  select coalesce(
    (
      select coalesce(nullif(btrim(full_name), ''), nullif(btrim(email), ''))
      from public.profiles
      where id = p_profile
    ),
    'Unassigned'
  );
$$;

create or replace function public.set_record_owner(p_kind text, p_id uuid, p_owner uuid)
returns void
language plpgsql
security definer
set search_path = ops, public
as $$
begin
  if not (
    public.workspace_is_admin()
    or public.workspace_can('operations', 'edit')
    or public.workspace_can('sales', 'edit')
  ) then
    raise exception 'app: You cannot change the owner.';
  end if;
  if p_owner is not null and not exists (
    select 1 from public.profiles
    where id = p_owner and deleted_at is null and is_active and access_granted
  ) then
    raise exception 'app: Choose an active person.';
  end if;
  if p_kind = 'job' then
    update ops.install_jobs
    set owner_user_id = p_owner, owner_rep_id = p_owner
    where id = p_id;
  elsif p_kind = 'install' then
    update ops.installs set owner_user_id = p_owner where id = p_id;
  elsif p_kind = 'quote' then
    update ops.install_quotes set owner_user_id = p_owner where id = p_id;
  elsif p_kind = 'service_quote' then
    update ops.service_quotes set owner_user_id = p_owner where id = p_id;
  else
    raise exception 'app: That record cannot have an owner.';
  end if;
  if not found then
    raise exception 'app: That record was not found.';
  end if;
end;
$$;

revoke all on function public.set_record_owner(text, uuid, uuid) from public, anon;
grant execute on function public.set_record_owner(text, uuid, uuid) to authenticated, service_role;

create or replace function public.admin_delete_user(p_profile uuid)
returns jsonb
language plpgsql
security definer
set search_path = ops, core, public
as $$
declare
  v_target public.profiles%rowtype;
  v_blockers text[] := '{}';
  v_line text;
  v_history boolean := false;
  v_hit boolean;
  v_fk record;
  v_skip text[] := array[
    'public.module_access',
    'public.workspace_team_members',
    'public.notifications',
    'core.notifications'
  ];
begin
  if not public.workspace_is_admin() then
    raise exception 'app: Only a workspace owner or admin can delete a user.';
  end if;
  if p_profile is null or p_profile = auth.uid() then
    raise exception 'app: You cannot delete yourself.';
  end if;
  select * into v_target from public.profiles where id = p_profile and deleted_at is null;
  if v_target.id is null then
    raise exception 'app: That user was not found.';
  end if;
  if v_target.workspace_role in ('owner', 'admin')
     and v_target.is_active
     and (
       select count(*) from public.profiles
       where deleted_at is null
         and is_active
         and workspace_role in ('owner', 'admin')
     ) <= 1
  then
    raise exception 'app: You cannot delete the last admin.';
  end if;

  for v_line in
    select i.order_number || ' (' || to_char(i.start_on, 'DD/MM/YYYY') || ')'
    from ops.installs i
    where i.booking_rep_id = p_profile
      and i.status not in ('completed', 'cancelled')
      and i.end_on >= (timezone('Europe/London', now()))::date
    order by i.start_on
    limit 8
  loop
    v_blockers := v_blockers || ('Future booking: ' || v_line);
  end loop;

  for v_line in
    select coalesce(nullif(btrim(e.entry_type), ''), 'calendar')
      || ' ' || to_char(e.starts_on, 'DD/MM/YYYY')
      || '–' || to_char(e.ends_on, 'DD/MM/YYYY')
    from public.calendar_entries e
    where e.profile_id = p_profile
      and e.request_status <> 'declined'
      and e.ends_on >= (timezone('Europe/London', now()))::date
    order by e.starts_on
    limit 8
  loop
    v_blockers := v_blockers || ('Schedule: ' || replace(v_line, '_', ' '));
  end loop;

  if cardinality(v_blockers) > 0 then
    raise exception 'app: This user still has work assigned. %', array_to_string(v_blockers, ' ');
  end if;

  update ops.install_quotes set owner_user_id = null where owner_user_id = p_profile;
  update ops.service_quotes set owner_user_id = null where owner_user_id = p_profile;
  update ops.install_jobs
  set owner_user_id = null,
      owner_rep_id = case when owner_rep_id = p_profile then null else owner_rep_id end
  where owner_user_id = p_profile or owner_rep_id = p_profile;
  update ops.installs set owner_user_id = null where owner_user_id = p_profile;
  update core.tasks
  set assignee_id = null
  where assignee_id = p_profile and status in ('open', 'in_progress');

  for v_fk in
    select n.nspname as schema_name, c.relname as table_name, a.attname as column_name
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    join lateral unnest(con.conkey) as cols(attnum) on true
    join pg_attribute a on a.attrelid = c.oid and a.attnum = cols.attnum
    where con.contype = 'f'
      and con.confrelid = 'public.profiles'::regclass
  loop
    if (v_fk.schema_name || '.' || v_fk.table_name) = any (v_skip) then
      continue;
    end if;
    if v_fk.schema_name = 'public' and v_fk.table_name = 'profiles' then
      continue;
    end if;
    execute format(
      'select exists (select 1 from %I.%I where %I = $1)',
      v_fk.schema_name, v_fk.table_name, v_fk.column_name
    ) into v_hit using p_profile;
    if v_hit then
      v_history := true;
      exit;
    end if;
  end loop;

  insert into public.access_audit_log (actor_id, action, entity_type, entity_id, before, after)
  values (
    auth.uid(),
    'user.deleted',
    'profile',
    p_profile,
    jsonb_build_object('full_name', v_target.full_name, 'email', v_target.email, 'workspace_role', v_target.workspace_role),
    jsonb_build_object('mode', case when v_history then 'soft' else 'hard' end)
  );

  perform set_config('orbit.profile_sync', 'on', true);
  update public.profiles
  set deleted_at = now(),
      is_active = false,
      access_granted = false
  where id = p_profile;

  return jsonb_build_object('mode', case when v_history then 'soft' else 'hard' end);
end;
$$;

revoke all on function public.admin_delete_user(uuid) from public, anon;
grant execute on function public.admin_delete_user(uuid) to authenticated, service_role;

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
    where p.deleted_at is null
  ), '[]'::jsonb);
end;
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
    'ownerUserId', p_row.owner_user_id,
    'ownerName', public.owner_name(p_row.owner_user_id),
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
        'created_at', j.created_at,
        'owner_user_id', j.owner_user_id,
        'owner_name', public.owner_name(j.owner_user_id)
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
    'owner_user_id', v_job.owner_user_id,
    'owner_name', public.owner_name(v_job.owner_user_id),
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
