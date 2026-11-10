-- Workspace effective access replaces the old install role on server checks.
-- Owner (workspace_role = owner, or the named is_owner flag) can do everything.
-- access_audit_log records user/access admin changes and job status changes.
-- Owners can read it. Clients cannot write it.

-- ---------------------------------------------------------------------------
-- Levels
-- ---------------------------------------------------------------------------

create or replace function public.workspace_level(p_profile uuid, p_module text)
returns text
language plpgsql
stable
security definer
set search_path = public, core
as $$
declare
  v_mode text;
  v_role text;
  v_custom text;
  v_team text;
  v_named_owner boolean;
begin
  select access_mode, workspace_role into v_mode, v_role
  from public.profiles
  where id = p_profile;

  select exists (
    select 1 from core.ops_roles r
    where r.profile_id = p_profile and r.is_owner
  ) into v_named_owner;

  if v_role is null and not coalesce(v_named_owner, false) then
    return 'none';
  end if;

  -- Owner is edit on every module, including a custom grid set to none.
  if v_role = 'owner' or coalesce(v_named_owner, false) then
    return 'edit';
  end if;

  if v_mode = 'custom' then
    select access_level into v_custom
    from public.module_access
    where profile_id = p_profile and module_id = p_module;
    return coalesce(v_custom, 'none');
  end if;

  select case max(case a.access_level when 'edit' then 2 when 'view' then 1 else 0 end)
    when 2 then 'edit'
    when 1 then 'view'
    else 'none'
  end
  into v_team
  from public.workspace_team_access a
  join public.workspace_team_members m on m.team_id = a.team_id
  where m.profile_id = p_profile
    and a.module_id = p_module;
  v_team := coalesce(v_team, 'none');

  if v_role = 'admin' then
    return 'edit';
  elsif v_role = 'viewer' then
    return case when v_team = 'none' then 'none' else 'view' end;
  elsif v_role = 'manager' then
    return case when v_team = 'none' then 'view' else v_team end;
  else
    return v_team;
  end if;
end;
$$;

create or replace function public.workspace_is_owner()
returns boolean
language sql
stable
security definer
set search_path = public, core
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.is_active
      and p.access_granted
      and (
        p.workspace_role = 'owner'
        or exists (
          select 1 from core.ops_roles r
          where r.profile_id = p.id and r.is_owner
        )
      )
  );
$$;

create or replace function public.workspace_can(p_module text, p_need text)
returns boolean
language sql
stable
security definer
set search_path = public, core
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.is_active
      and p.access_granted
      and (
        p.workspace_role = 'owner'
        or exists (
          select 1 from core.ops_roles r
          where r.profile_id = p.id and r.is_owner
        )
        or public.workspace_level(p.id, p_module) = 'edit'
        or (
          p_need is distinct from 'edit'
          and public.workspace_level(p.id, p_module) = 'view'
        )
      )
  );
$$;

comment on function public.workspace_can(text, text) is
  'True when the signed-in person has the module at view or edit. Owner passes every module.';

revoke all on function public.workspace_is_owner() from public, anon;
revoke all on function public.workspace_can(text, text) from public, anon;
grant execute on function public.workspace_is_owner() to authenticated, service_role;
grant execute on function public.workspace_can(text, text) to authenticated, service_role;

-- Legacy role lists no longer read core.ops_roles.
-- A list that is only admin_owner / ops_manager is the owner.
-- installer in the list means operations view is enough (a read).
-- install_lead, hq, admin_owner, or ops_manager otherwise means operations edit.
-- sales beside a write list (no installer, no hq) means sales edit.
-- sales alone, or sales on a read list, means sales view.
create or replace function core.has_ops_role(roles text[])
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ops text;
  v_sales text;
begin
  if auth.uid() is null or roles is null or cardinality(roles) = 0 then
    return false;
  end if;
  if public.workspace_is_owner() then
    return true;
  end if;
  if roles <@ array['admin_owner', 'ops_manager']::text[] then
    return false;
  end if;

  if 'installer' = any (roles) then
    v_ops := 'view';
  elsif 'install_lead' = any (roles)
     or 'hq' = any (roles)
     or 'admin_owner' = any (roles)
     or 'ops_manager' = any (roles) then
    v_ops := 'edit';
  end if;

  if 'sales' = any (roles) then
    if 'installer' = any (roles) or 'hq' = any (roles) then
      v_sales := 'view';
    elsif v_ops = 'edit' then
      v_sales := 'edit';
    else
      v_sales := 'view';
    end if;
  end if;

  return (v_ops is not null and public.workspace_can('operations', v_ops))
      or (v_sales is not null and public.workspace_can('sales', v_sales));
end;
$$;

comment on function core.has_ops_role(text[]) is
  'Compatibility shim. Callers still pass old role names; the decision is workspace_can.';

create or replace function core.is_ops_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.workspace_is_owner();
$$;

comment on function core.is_ops_owner() is
  'True for a workspace owner, including the named owner flag.';

-- ---------------------------------------------------------------------------
-- Row visibility. Operations view sees the module. Sales view, without
-- operations view, sees their own customers and jobs. Cost stays on edit.
-- ---------------------------------------------------------------------------

create or replace function ops.job_visible(p_job_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ops, public
as $$
  select exists (
    select 1
    from ops.install_jobs j
    where j.id = p_job_id
      and (
        public.workspace_can('operations', 'view')
        or (
          public.workspace_can('sales', 'view')
          and j.owner_rep_id = auth.uid()
        )
      )
  );
$$;

create or replace function ops.customer_visible(p_customer_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ops, public
as $$
  select exists (
    select 1
    from ops.customers c
    where c.id = p_customer_id
      and (
        public.workspace_can('operations', 'view')
        or (
          public.workspace_can('sales', 'view')
          and (
            c.owner_rep_id = auth.uid()
            or exists (
              select 1
              from ops.install_jobs j
              where j.customer_id = c.id
                and j.owner_rep_id = auth.uid()
            )
          )
        )
      )
  );
$$;

create or replace function ops.site_visible(p_site_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ops, public
as $$
  select exists (
    select 1
    from ops.sites s
    where s.id = p_site_id
      and (
        public.workspace_can('operations', 'view')
        or (
          public.workspace_can('sales', 'view')
          and ops.customer_visible(s.customer_id)
        )
      )
  );
$$;

create or replace function ops.site_contact_visible(p_contact_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ops, public
as $$
  select exists (
    select 1
    from ops.site_contacts c
    join ops.sites s on s.id = c.site_id
    where c.id = p_contact_id
      and (
        public.workspace_can('operations', 'view')
        or (
          public.workspace_can('sales', 'view')
          and ops.customer_visible(s.customer_id)
        )
      )
  );
$$;

create or replace function ops.sales_job_visible(p_job_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ops, public
as $$
  select exists (
    select 1
    from ops.install_jobs j
    where j.id = p_job_id
      and (
        public.workspace_can('operations', 'view')
        or (
          public.workspace_can('sales', 'view')
          and j.owner_rep_id = auth.uid()
        )
      )
  );
$$;

create or replace function ops.money_visible(p_job_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ops, public
as $$
  select public.workspace_can('operations', 'edit')
    and exists (select 1 from ops.install_jobs j where j.id = p_job_id);
$$;

create or replace function ops.field_visible(p_job_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ops, public
as $$
  select public.workspace_can('operations', 'view')
    and exists (select 1 from ops.install_jobs j where j.id = p_job_id);
$$;

create or replace function ops.build_visible(p_job_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ops, public
as $$
  select public.workspace_can('operations', 'view')
    and exists (select 1 from ops.install_jobs j where j.id = p_job_id);
$$;

create or replace function ops.can_price()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.workspace_can('sales', 'edit')
      or public.workspace_can('operations', 'edit');
$$;

revoke all on function ops.can_price() from public, anon, authenticated;

create or replace view ops.quote_customer_prices
with (security_barrier = true, security_invoker = false) as
select
  q.id,
  q.job_id,
  q.mode,
  q.customer_price,
  q.finality,
  q.segment,
  q.provisional_items,
  q.created_at
from ops.quote_versions q
join ops.install_jobs j on j.id = q.job_id
where public.workspace_can('sales', 'view')
  and j.owner_rep_id = auth.uid();

comment on view ops.quote_customer_prices is
  'Customer price for the signed-in salesperson''s own jobs. Cost and markup are omitted.';

-- ---------------------------------------------------------------------------
-- Policies that named an install role now name a level.
-- ---------------------------------------------------------------------------

drop policy if exists "Read own operations role" on core.ops_roles;
create policy "Read own operations role"
on core.ops_roles
for select
to authenticated
using (profile_id = auth.uid() or public.workspace_is_owner() or public.workspace_is_admin());

drop policy if exists "Leads read workflow definitions" on core.workflow_definitions;
create policy "Operations view reads workflow definitions"
on core.workflow_definitions
for select
to authenticated
using (public.workspace_can('operations', 'view'));

drop policy if exists "Leads read workflow states" on core.workflow_states;
create policy "Operations view reads workflow states"
on core.workflow_states
for select
to authenticated
using (public.workspace_can('operations', 'view'));

drop policy if exists "Leads read workflow transitions" on core.workflow_transitions;
create policy "Operations view reads workflow transitions"
on core.workflow_transitions
for select
to authenticated
using (public.workspace_can('operations', 'view'));

drop policy if exists "Leads read the operations audit log" on core.audit_log;
create policy "Owners read the operations audit log"
on core.audit_log
for select
to authenticated
using (public.workspace_is_owner());

drop policy if exists "Read tasks you are involved in" on core.tasks;
create policy "Read tasks you are involved in"
on core.tasks
for select
to authenticated
using (
  assignee_id = auth.uid()
  or created_by = auth.uid()
  or public.workspace_can('operations', 'view')
);

drop policy if exists "Leads and HQ create tasks" on core.tasks;
create policy "Operations edit creates tasks"
on core.tasks
for insert
to authenticated
with check (
  created_by = auth.uid()
  and public.workspace_can('operations', 'edit')
);

drop policy if exists "Assignees and leads update tasks" on core.tasks;
create policy "Assignees and operations edit update tasks"
on core.tasks
for update
to authenticated
using (assignee_id = auth.uid() or public.workspace_can('operations', 'edit'))
with check (assignee_id = auth.uid() or public.workspace_can('operations', 'edit'));

drop policy if exists "Leads and the owner read settings" on core.settings;
create policy "Operations edit reads settings"
on core.settings
for select
to authenticated
using (public.workspace_can('operations', 'edit'));

drop policy if exists "Leads read file metadata" on core.files;
create policy "Operations edit reads file metadata"
on core.files
for select
to authenticated
using (public.workspace_can('operations', 'edit'));

drop policy if exists "Assigned roles read job file metadata" on core.files;
create policy "Visible jobs read file metadata"
on core.files
for select
to authenticated
using (
  (
    entity_schema = 'ops'
    and entity_table = 'install_jobs'
    and ops.job_visible(entity_id)
    and (
      public.workspace_can('operations', 'view')
      or (
        public.workspace_can('sales', 'view')
        and bucket in ('access-media', 'terms')
      )
    )
  )
  or (
    bucket = 'terms'
    and (
      public.workspace_can('sales', 'view')
      or public.workspace_can('operations', 'view')
    )
  )
);

drop policy if exists "Leads read gate overrides" on core.gate_overrides;
create policy "Operations edit reads gate overrides"
on core.gate_overrides
for select
to authenticated
using (public.workspace_can('operations', 'edit'));

drop policy if exists "Leads read pricing settings" on ops.pricing_settings;
create policy "Operations edit reads pricing settings"
on ops.pricing_settings
for select
to authenticated
using (public.workspace_can('operations', 'edit'));

drop policy if exists "Staff read terms versions" on ops.terms_versions;
create policy "Operations or sales view reads terms"
on ops.terms_versions
for select
to authenticated
using (public.workspace_can('operations', 'view') or public.workspace_can('sales', 'view'));

drop policy if exists "Leads and HQ read effort versions" on ops.effort_table_versions;
create policy "Operations view reads effort versions"
on ops.effort_table_versions
for select
to authenticated
using (public.workspace_can('operations', 'view'));

drop policy if exists "Leads and HQ read effort rows" on ops.effort_rows;
create policy "Operations view reads effort rows"
on ops.effort_rows
for select
to authenticated
using (public.workspace_can('operations', 'view'));

drop policy if exists "Leads update hold and lost reasons" on ops.install_jobs;
create policy "Operations edit updates hold and lost reasons"
on ops.install_jobs
for update
to authenticated
using (public.workspace_can('operations', 'edit'))
with check (public.workspace_can('operations', 'edit'));

drop policy if exists "Leads read portal links" on ops.portal_links;
create policy "Operations edit reads portal links"
on ops.portal_links
for select
to authenticated
using (public.workspace_can('operations', 'edit') and ops.job_visible(job_id));

drop policy if exists "Operations staff read resources" on ops.resources;
create policy "Operations or sales view reads resources"
on ops.resources
for select
to authenticated
using (public.workspace_can('operations', 'view') or public.workspace_can('sales', 'view'));

drop policy if exists "Read visible reservations" on ops.reservations;
create policy "Read visible reservations"
on ops.reservations
for select
to authenticated
using (
  public.workspace_can('operations', 'view')
  or (
    public.workspace_can('sales', 'view')
    and ops.sales_job_visible(job_id)
  )
);

drop policy if exists "Leads and HQ read unavailability" on ops.unavailability;
create policy "Operations view reads unavailability"
on ops.unavailability
for select
to authenticated
using (public.workspace_can('operations', 'view'));

drop policy if exists "Field staff read van checks" on ops.van_checks;
create policy "Operations view reads van checks"
on ops.van_checks
for select
to authenticated
using (public.workspace_can('operations', 'view'));

drop policy if exists "Leads and HQ read fleet tasks" on ops.fleet_tasks;
create policy "Operations view reads fleet tasks"
on ops.fleet_tasks
for select
to authenticated
using (public.workspace_can('operations', 'view'));

drop policy if exists "Leads and HQ read QC checklists" on ops.qc_checklists;
create policy "Operations view reads QC checklists"
on ops.qc_checklists
for select
to authenticated
using (public.workspace_can('operations', 'view'));

drop policy if exists "Read visible assets" on ops.assets;
create policy "Operations view reads assets"
on ops.assets
for select
to authenticated
using (
  public.workspace_can('operations', 'view')
  and (job_id is null or ops.build_visible(job_id))
);

drop policy if exists "Leads read subcontractors" on ops.subcontractors;
create policy "Operations edit reads subcontractors"
on ops.subcontractors
for select
to authenticated
using (public.workspace_can('operations', 'edit'));

drop policy if exists "Leads read feedback" on ops.feedback;
create policy "Operations view reads feedback"
on ops.feedback
for select
to authenticated
using (public.workspace_can('operations', 'view') and ops.job_visible(job_id));

drop policy if exists "Leads read revisit causes" on ops.revisit_causes;
create policy "Operations view reads revisit causes"
on ops.revisit_causes
for select
to authenticated
using (public.workspace_can('operations', 'view'));

-- ---------------------------------------------------------------------------
-- RPCs whose guard was the module switch or a sales write.
-- ---------------------------------------------------------------------------

create or replace function public.orbit_office_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = core, public
as $$
declare
  v_role text;
begin
  if auth.uid() is null then
    raise exception 'app: You need to be signed in.';
  end if;

  select ops_role into v_role
  from core.ops_roles
  where profile_id = auth.uid();

  return jsonb_build_object(
    'has_module', public.workspace_can('operations', 'view'),
    'ops_role', v_role,
    'is_owner', public.workspace_is_owner(),
    'operations', public.workspace_level(auth.uid(), 'operations'),
    'sales', public.workspace_level(auth.uid(), 'sales')
  );
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

create or replace function public.orbit_list_access_submissions(p_job_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ops, core, public
as $$
begin
  if not public.workspace_can('operations', 'edit') then
    raise exception 'app: You need edit access on Operations to review an access form.';
  end if;
  if not ops.job_visible(p_job_id) then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', a.id,
      'answers', a.answers,
      'media_file_ids', a.media_file_ids,
      'accepted_at', a.accepted_at,
      'accepted_by_name', a.accepted_by_name,
      'terms_version_id', a.terms_version_id,
      'created_at', a.created_at
    ) order by a.created_at desc)
    from ops.access_submissions a
    where a.job_id = p_job_id
  ), '[]'::jsonb);
end;
$$;

create or replace function public.orbit_pencil_range(
  p_job_id uuid,
  p_start date,
  p_allow_weekends boolean,
  p_resource_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ops, core, public
as $$
declare
  v_job ops.install_jobs%rowtype;
  v_need ops.job_requirements%rowtype;
  v_owner boolean;
  v_dates date[] := '{}';
  v_cursor date;
  v_guard integer := 0;
  v_day date;
  v_problem text;
begin
  if auth.uid() is null then
    raise exception 'app: You need to be signed in.';
  end if;
  select * into v_job from ops.install_jobs where id = p_job_id;
  if v_job.id is null then
    raise exception 'app: That job was not found.';
  end if;
  if not (
    public.workspace_can('operations', 'edit')
    or (public.workspace_can('sales', 'edit') and v_job.owner_rep_id = auth.uid())
  ) then
    raise exception 'app: You cannot pencil that job.';
  end if;
  select * into v_need from ops.job_requirements where job_id = p_job_id;
  if v_need.job_id is null then
    raise exception 'app: This job has no required resources yet.';
  end if;

  v_owner := public.workspace_is_owner();
  if coalesce(p_allow_weekends, false) and not v_owner then
    raise exception 'app: Weekend installs can only be pencilled by the owner.';
  end if;
  if extract(dow from p_start) in (0, 6) and not (v_owner and coalesce(p_allow_weekends, false)) then
    raise exception 'app: Weekend installs can only be pencilled by the owner.';
  end if;

  v_cursor := p_start;
  while cardinality(v_dates) < v_need.install_days and v_guard < 400 loop
    v_guard := v_guard + 1;
    if coalesce(p_allow_weekends, false) or extract(dow from v_cursor) not in (0, 6) then
      v_dates := v_dates || v_cursor;
    end if;
    v_cursor := v_cursor + 1;
  end loop;

  if cardinality(v_dates) < v_need.install_days then
    raise exception 'app: That start day does not cover the install.';
  end if;

  foreach v_day in array v_dates loop
    if extract(dow from v_day) in (0, 6) and not v_owner then
      raise exception 'app: Weekend installs can only be pencilled by the owner.';
    end if;
    v_problem := ops.assignment_problem(
      v_need.installers,
      v_need.licensed_drivers,
      v_need.van_size,
      v_need.van_count,
      v_need.stair_climber,
      p_resource_ids,
      v_day,
      p_job_id
    );
    if v_problem is not null then
      raise exception 'app: %', v_problem;
    end if;
  end loop;

  delete from ops.reservations
  where job_id = p_job_id and kind = 'pencil';

  insert into ops.reservations (resource_id, job_id, day, kind)
  select picked.id, p_job_id, booked.day, 'pencil'
  from unnest(p_resource_ids) as picked(id)
  cross join unnest(v_dates) as booked(day);

  update ops.install_jobs
  set requested_date = v_dates[1],
      requested_end = v_dates[cardinality(v_dates)]
  where id = p_job_id;

  update ops.job_requirements
  set conflict = false, conflict_detail = null, updated_at = now()
  where job_id = p_job_id;

  return jsonb_build_object(
    'job_id', p_job_id,
    'start', v_dates[1],
    'end', v_dates[cardinality(v_dates)],
    'days', cardinality(v_dates),
    'kind', 'pencil'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Audit log. Who, what, when, entity, before, after. Owners read. No client writes.
-- ---------------------------------------------------------------------------

create table if not exists public.access_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);

create index if not exists access_audit_log_created_idx
  on public.access_audit_log (created_at desc);

create index if not exists access_audit_log_entity_idx
  on public.access_audit_log (entity_type, entity_id, created_at desc);

create index if not exists access_audit_log_actor_idx
  on public.access_audit_log (actor_id, created_at desc);

comment on table public.access_audit_log is
  'Who changed access or a job status, when, and the before/after JSON. Owners can read. Rows are immutable.';

create or replace function public.prevent_access_audit_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'access_audit_log is immutable';
end;
$$;

drop trigger if exists access_audit_log_immutable on public.access_audit_log;
create trigger access_audit_log_immutable
before update or delete on public.access_audit_log
for each row execute function public.prevent_access_audit_mutation();

create or replace function public.write_access_audit(
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_before jsonb,
  p_after jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.access_audit_log (actor_id, action, entity_type, entity_id, before, after)
  values (auth.uid(), p_action, p_entity_type, p_entity_id, p_before, p_after);
end;
$$;

revoke all on function public.write_access_audit(text, text, uuid, jsonb, jsonb) from public, anon, authenticated;

alter table public.access_audit_log enable row level security;
revoke all on table public.access_audit_log from public, anon, authenticated;
grant select on table public.access_audit_log to authenticated;
grant all on table public.access_audit_log to service_role;

drop policy if exists "Owners read the access audit log" on public.access_audit_log;
create policy "Owners read the access audit log"
on public.access_audit_log
for select
to authenticated
using (public.workspace_is_owner());

create or replace function ops.audit_job_status_change()
returns trigger
language plpgsql
security definer
set search_path = public, ops
as $$
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    perform public.write_access_audit(
      'job.status_changed',
      'install_job',
      new.id,
      jsonb_build_object('status', old.status),
      jsonb_build_object('status', new.status)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists install_jobs_access_audit on ops.install_jobs;
create trigger install_jobs_access_audit
after update of status on ops.install_jobs
for each row execute function ops.audit_job_status_change();

-- ---------------------------------------------------------------------------
-- User and access admin RPCs write the audit row around the change.
-- ---------------------------------------------------------------------------

create or replace function public.workspace_save_team(p_id uuid, p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := nullif(trim(coalesce(p_name, '')), '');
  v_id uuid := p_id;
  v_before jsonb;
begin
  if not public.workspace_is_admin() then
    raise exception 'app: Only a workspace owner or admin can edit teams.';
  end if;
  if v_name is null or char_length(v_name) > 80 then
    raise exception 'app: Give the team a name.';
  end if;
  if v_id is null then
    insert into public.workspace_teams (name) values (v_name) returning id into v_id;
  else
    select to_jsonb(t) into v_before from public.workspace_teams t where t.id = v_id;
    update public.workspace_teams set name = v_name where id = v_id;
    if not found then
      raise exception 'app: That team was not found.';
    end if;
  end if;
  perform public.write_access_audit(
    'team.saved',
    'workspace_team',
    v_id,
    v_before,
    jsonb_build_object('name', v_name)
  );
  return v_id;
end;
$$;

create or replace function public.workspace_delete_team(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before jsonb;
begin
  if not public.workspace_is_admin() then
    raise exception 'app: Only a workspace owner or admin can delete a team.';
  end if;
  select to_jsonb(t) into v_before from public.workspace_teams t where t.id = p_id;
  delete from public.workspace_teams where id = p_id;
  if v_before is not null then
    perform public.write_access_audit('team.deleted', 'workspace_team', p_id, v_before, null);
  end if;
end;
$$;

create or replace function public.workspace_save_user(
  p_profile uuid,
  p_workspace_role text,
  p_access_mode text,
  p_team_ids uuid[],
  p_custom jsonb,
  p_active boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_module text;
  v_level text;
  v_before jsonb;
  v_after jsonb;
begin
  if not public.workspace_is_admin() then
    raise exception 'app: Only a workspace owner or admin can edit users.';
  end if;
  if p_workspace_role not in ('owner', 'admin', 'manager', 'member', 'viewer') then
    raise exception 'app: Choose a workspace role.';
  end if;
  if p_access_mode not in ('follow', 'custom') then
    raise exception 'app: Choose how access is resolved.';
  end if;
  if exists (
    select 1 from public.profiles
    where id = p_profile and lower(email) = 'alex.ives@jordanfitness.com'
  ) and (p_workspace_role <> 'owner' or p_active is false) then
    raise exception 'app: Alex stays an owner.';
  end if;

  select jsonb_build_object(
    'workspace_role', p.workspace_role,
    'access_mode', p.access_mode,
    'is_active', p.is_active,
    'role', p.role,
    'teams', coalesce((
      select jsonb_agg(m.team_id order by m.team_id)
      from public.workspace_team_members m
      where m.profile_id = p.id
    ), '[]'::jsonb),
    'levels', coalesce((
      select jsonb_object_agg(a.module_id, a.access_level)
      from public.module_access a
      where a.profile_id = p.id
    ), '{}'::jsonb)
  )
  into v_before
  from public.profiles p
  where p.id = p_profile;

  if v_before is null then
    raise exception 'app: That person could not be found.';
  end if;

  update public.profiles
  set workspace_role = p_workspace_role,
      access_mode = p_access_mode,
      is_active = p_active,
      role = case
        when p_workspace_role in ('owner', 'admin') then 'admin'
        when p_workspace_role = 'manager' then 'approver'
        else 'staff'
      end
  where id = p_profile;

  delete from public.workspace_team_members where profile_id = p_profile;
  insert into public.workspace_team_members (team_id, profile_id)
  select team_id, p_profile
  from unnest(coalesce(p_team_ids, '{}'::uuid[])) as team_id;

  if p_access_mode = 'custom' and p_custom is not null then
    for v_module, v_level in
      select key, value
      from jsonb_each_text(p_custom)
    loop
      if v_module in ('people', 'service', 'supply', 'operations', 'sales', 'finance')
         and v_level in ('none', 'view', 'edit') then
        insert into public.module_access (profile_id, module_id, enabled, access_level)
        values (p_profile, v_module, v_level <> 'none', v_level)
        on conflict (profile_id, module_id) do update
          set enabled = excluded.enabled,
              access_level = excluded.access_level;
      end if;
    end loop;
  end if;

  select jsonb_build_object(
    'workspace_role', p.workspace_role,
    'access_mode', p.access_mode,
    'is_active', p.is_active,
    'role', p.role,
    'teams', coalesce((
      select jsonb_agg(m.team_id order by m.team_id)
      from public.workspace_team_members m
      where m.profile_id = p.id
    ), '[]'::jsonb),
    'levels', coalesce((
      select jsonb_object_agg(a.module_id, a.access_level)
      from public.module_access a
      where a.profile_id = p.id
    ), '{}'::jsonb)
  )
  into v_after
  from public.profiles p
  where p.id = p_profile;

  perform public.write_access_audit('user.access_changed', 'profile', p_profile, v_before, v_after);
end;
$$;

create or replace function public.workspace_prepare_invite(
  p_email text,
  p_full_name text,
  p_workspace_role text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_name text := nullif(trim(coalesce(p_full_name, '')), '');
  v_workspace text := p_workspace_role;
  v_role text;
  v_user_id uuid;
  v_existing boolean := false;
begin
  if not public.workspace_is_admin() then
    raise exception 'app: Only a workspace owner or admin can invite someone.';
  end if;
  if v_email !~ '^[^@[:space:]]+@jordanfitness\.com$' then
    raise exception 'app: Use a @jordanfitness.com email address.';
  end if;
  if v_workspace not in ('owner', 'admin', 'manager', 'member', 'viewer') then
    raise exception 'app: Choose a workspace role.';
  end if;
  v_role := case
    when v_workspace in ('owner', 'admin') then 'admin'
    when v_workspace = 'manager' then 'approver'
    else 'staff'
  end;

  insert into public.access_grants (email, full_name, role, people_enabled, invited_by)
  values (v_email, v_name, v_role, true, auth.uid())
  on conflict (email) do update
    set full_name = excluded.full_name,
        role = excluded.role,
        people_enabled = true,
        invited_by = excluded.invited_by,
        updated_at = now();

  select id into v_user_id from auth.users where lower(email) = v_email limit 1;
  if v_user_id is not null then
    v_existing := true;
    update public.profiles
    set full_name = coalesce(v_name, full_name),
        role = v_role,
        workspace_role = v_workspace,
        access_mode = 'follow',
        is_active = true,
        access_granted = true
    where id = v_user_id;
    perform private.seed_module_access(v_user_id, true);
  end if;

  perform public.write_access_audit(
    'user.invited',
    'profile',
    v_user_id,
    null,
    jsonb_build_object(
      'email', v_email,
      'full_name', v_name,
      'workspace_role', v_workspace,
      'role', v_role,
      'already_registered', v_existing
    )
  );

  return jsonb_build_object(
    'email', v_email,
    'role', v_role,
    'already_registered', v_existing,
    'user_id', v_user_id
  );
end;
$$;

create or replace function public.admin_prepare_invite(
  p_email text,
  p_full_name text,
  p_role text,
  p_people_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_name text := nullif(trim(coalesce(p_full_name, '')), '');
  v_role text := p_role;
  v_people boolean := coalesce(p_people_enabled, true);
  v_user_id uuid;
  v_existing boolean := false;
begin
  if not public.is_admin() then
    raise exception 'app: Only an administrator can invite someone.';
  end if;

  if v_email !~ '^[^@[:space:]]+@jordanfitness\.com$' then
    raise exception 'app: Use a @jordanfitness.com email address.';
  end if;

  if v_role not in ('admin', 'approver', 'staff') then
    raise exception 'app: Choose a role.';
  end if;

  if v_email = 'alex.ives@jordanfitness.com' then
    v_role := 'admin';
    v_people := true;
  end if;

  insert into public.access_grants (email, full_name, role, people_enabled, invited_by)
  values (v_email, v_name, v_role, v_people, auth.uid())
  on conflict (email) do update
    set full_name = excluded.full_name,
        role = excluded.role,
        people_enabled = excluded.people_enabled,
        invited_by = excluded.invited_by,
        updated_at = now();

  select id into v_user_id
  from auth.users
  where lower(email) = v_email
  limit 1;

  if v_user_id is not null then
    v_existing := true;

    update public.profiles
    set full_name = coalesce(v_name, full_name),
        role = v_role,
        is_active = true,
        access_granted = true
    where id = v_user_id;

    perform private.seed_module_access(v_user_id, v_people);
  end if;

  perform public.write_access_audit(
    'user.invited',
    'profile',
    v_user_id,
    null,
    jsonb_build_object(
      'email', v_email,
      'full_name', v_name,
      'role', v_role,
      'people_enabled', v_people,
      'already_registered', v_existing
    )
  );

  return jsonb_build_object(
    'email', v_email,
    'role', v_role,
    'already_registered', v_existing,
    'user_id', v_user_id
  );
end;
$$;

create or replace function public.admin_update_member(
  p_user_id uuid,
  p_role text,
  p_is_active boolean,
  p_people_enabled boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_role text := p_role;
  v_before jsonb;
  v_after jsonb;
begin
  if not public.is_admin() then
    raise exception 'app: Only an administrator can change access.';
  end if;

  if v_role not in ('admin', 'approver', 'staff') then
    raise exception 'app: Choose a role.';
  end if;

  select jsonb_build_object(
    'email', p.email,
    'role', p.role,
    'is_active', p.is_active,
    'access_granted', p.access_granted,
    'people', coalesce((
      select a.access_level
      from public.module_access a
      where a.profile_id = p.id and a.module_id = 'people'
    ), 'none')
  ), p.email
  into v_before, v_email
  from public.profiles p
  where p.id = p_user_id;

  if v_email is null then
    raise exception 'app: That person could not be found.';
  end if;

  if lower(v_email) = 'alex.ives@jordanfitness.com' then
    v_role := 'admin';
  end if;

  update public.profiles
  set role = v_role,
      is_active = p_is_active,
      access_granted = case when p_is_active then true else access_granted end
  where id = p_user_id;

  perform private.seed_module_access(p_user_id, coalesce(p_people_enabled, false));

  select jsonb_build_object(
    'email', p.email,
    'role', p.role,
    'is_active', p.is_active,
    'access_granted', p.access_granted,
    'people', coalesce((
      select a.access_level
      from public.module_access a
      where a.profile_id = p.id and a.module_id = 'people'
    ), 'none')
  )
  into v_after
  from public.profiles p
  where p.id = p_user_id;

  perform public.write_access_audit('user.access_changed', 'profile', p_user_id, v_before, v_after);
end;
$$;
