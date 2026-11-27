-- HR Pulse Phase 2a. Joiner and leaver checklists.
-- Directors and workspace admins see every checklist. Line managers see their direct reports.
-- Employees do not see checklists in this phase. Two-step (aal2) matches the other HR records.
-- Ticking an item does not invite, deactivate a login, or change an engineer record.
-- ADDITIVE.
-- New file only. Do not apply to production.

alter table hr.employees
  add column engineer_resource_id uuid references ops.resources (id) on delete set null;

comment on column hr.employees.engineer_resource_id is
  'Optional field engineer record created with the joiner. Checklist ticks do not change the resource.';

create unique index hr_employees_engineer_resource_idx
  on hr.employees (engineer_resource_id)
  where engineer_resource_id is not null;

create table hr.checklist_templates (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('onboarding', 'offboarding')),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  items jsonb not null check (jsonb_typeof(items) = 'array'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index hr_checklist_templates_one_active_idx
  on hr.checklist_templates (kind)
  where active;

create table hr.checklists (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references hr.employees (id) on delete cascade,
  kind text not null check (kind in ('onboarding', 'offboarding')),
  template_id uuid references hr.checklist_templates (id) on delete set null,
  status text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  due_on date,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index hr_checklists_employee_idx on hr.checklists (employee_id);
create index hr_checklists_template_idx on hr.checklists (template_id);
create index hr_checklists_created_by_idx on hr.checklists (created_by);
create unique index hr_checklists_one_open_idx
  on hr.checklists (employee_id, kind)
  where status = 'open';

create table hr.checklist_items (
  id uuid primary key default gen_random_uuid(),
  checklist_id uuid not null references hr.checklists (id) on delete cascade,
  label text not null check (char_length(btrim(label)) between 1 and 120),
  owner text not null check (owner in ('manager', 'hr', 'it', 'operations')),
  due_on date,
  done_at timestamptz,
  done_by uuid references public.profiles (id) on delete set null,
  link_kind text not null default 'none' check (link_kind in ('pulse_invite', 'teams', 'engineer_record', 'deactivate_login', 'none')),
  position integer not null default 0 check (position >= 0),
  created_at timestamptz not null default now()
);

create index hr_checklist_items_checklist_idx on hr.checklist_items (checklist_id);
create index hr_checklist_items_done_by_idx on hr.checklist_items (done_by);

alter table hr.checklist_templates enable row level security;
alter table hr.checklists enable row level security;
alter table hr.checklist_items enable row level security;

revoke all on hr.checklist_templates, hr.checklists, hr.checklist_items from public, anon, authenticated;
grant select on hr.checklist_templates, hr.checklists, hr.checklist_items to authenticated;
grant all on hr.checklist_templates, hr.checklists, hr.checklist_items to service_role;

-- Direct reports only. A seat manager (hr.manages) or the manager_id on the employee.
-- manager_id is what the joiner form sets, and the org chart keeps it in step with the seat above.
create or replace function hr.checklist_reports(p_employee uuid)
returns boolean
language sql
stable
security definer
set search_path = hr, public
as $$
  select hr.manages(p_employee)
    or exists (
      select 1
      from hr.employees report
      join hr.employees manager on manager.id = report.manager_id
      where report.id = p_employee
        and manager.profile_id = (select auth.uid())
    );
$$;

create or replace function hr.checklist_visible(p_employee uuid)
returns boolean
language sql
stable
security definer
set search_path = hr, public
as $$
  select public.is_active_user()
    and hr.aal_ok()
    and (
      hr.is_director()
      or public.workspace_is_admin()
      or hr.checklist_reports(p_employee)
    );
$$;

-- Positive offsets roll Saturday and Sunday forward. Negative offsets roll them back.
create or replace function hr.shift_due(p_anchor date, p_offset integer)
returns date
language sql
immutable
as $$
  select case
    when p_anchor is null then null
    else (
      select case extract(isodow from shifted)::integer
        when 6 then case when p_offset < 0 then shifted - 1 else shifted + 2 end
        when 7 then case when p_offset < 0 then shifted - 2 else shifted + 1 end
        else shifted
      end
      from (select (p_anchor + p_offset)::date as shifted) raw
    )
  end;
$$;

create or replace function hr.template_items(p_template uuid, p_location text)
returns table (label text, owner text, offset_days integer, link_kind text, item_position integer)
language plpgsql
stable
set search_path = hr, public
as $$
declare
  v_item jsonb;
  v_index integer := 0;
  v_label text;
  v_owner text;
  v_offset integer;
  v_link text;
  v_field boolean;
begin
  for v_item in
    select elem
    from hr.checklist_templates t
    cross join lateral jsonb_array_elements(t.items) as elem
    where t.id = p_template
  loop
    v_label := nullif(btrim(v_item ->> 'label'), '');
    v_owner := v_item ->> 'owner';
    v_offset := coalesce((v_item ->> 'offset_days')::integer, 0);
    v_link := coalesce(v_item ->> 'link_kind', 'none');
    v_field := coalesce((v_item ->> 'field_only')::boolean, false);
    if v_label is null
       or char_length(v_label) > 120
       or v_owner not in ('manager', 'hr', 'it', 'operations')
       or v_link not in ('pulse_invite', 'teams', 'engineer_record', 'deactivate_login', 'none')
       or v_offset < -60
       or v_offset > 60
    then
      raise exception 'app: The checklist template is not valid.';
    end if;
    if v_field and p_location is distinct from 'field' then
      continue;
    end if;
    label := v_label;
    owner := v_owner;
    offset_days := v_offset;
    link_kind := v_link;
    item_position := v_index;
    v_index := v_index + 1;
    return next;
  end loop;
end;
$$;

create or replace function hr.refresh_checklist_status(p_checklist uuid)
returns void
language plpgsql
set search_path = hr, public
as $$
begin
  if exists (
    select 1 from hr.checklist_items
    where checklist_id = p_checklist and done_at is null
  ) then
    update hr.checklists
    set status = 'open'
    where id = p_checklist and status = 'done';
  else
    update hr.checklists
    set status = 'done'
    where id = p_checklist and status = 'open';
  end if;
end;
$$;

create or replace function hr.open_checklist(
  p_employee uuid,
  p_kind text,
  p_anchor date,
  p_location text,
  p_actor uuid
)
returns uuid
language plpgsql
set search_path = hr, public
as $$
declare
  v_template uuid;
  v_id uuid;
  v_count integer;
begin
  if p_kind not in ('onboarding', 'offboarding') then
    raise exception 'app: The checklist template is not valid.';
  end if;
  if p_anchor is null then
    raise exception 'app: Check the dates.';
  end if;
  select id into v_template
  from hr.checklist_templates
  where kind = p_kind and active
  order by created_at
  limit 1;
  if v_template is null then
    raise exception 'app: No checklist is set up.';
  end if;
  begin
    insert into hr.checklists (employee_id, kind, template_id, status, due_on, created_by)
    values (
      p_employee,
      p_kind,
      v_template,
      'open',
      hr.shift_due(p_anchor, case p_kind when 'onboarding' then 14 else 0 end),
      p_actor
    )
    returning id into v_id;
  exception
    when unique_violation then
      raise exception 'app: That checklist is already open.';
  end;
  insert into hr.checklist_items (checklist_id, label, owner, due_on, link_kind, position)
  select v_id, item.label, item.owner, hr.shift_due(p_anchor, item.offset_days), item.link_kind, item.item_position
  from hr.template_items(v_template, p_location) as item;
  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'app: The checklist template is not valid.';
  end if;
  return v_id;
end;
$$;

create policy checklist_templates_read on hr.checklist_templates
for select to authenticated
using (
  public.is_active_user()
  and hr.aal_ok()
  and (hr.is_director() or public.workspace_is_admin())
);

create policy checklists_read on hr.checklists
for select to authenticated
using (hr.checklist_visible(employee_id));

create policy checklist_items_read on hr.checklist_items
for select to authenticated
using (
  exists (
    select 1
    from hr.checklists c
    where c.id = checklist_id
      and hr.checklist_visible(c.employee_id)
  )
);

create or replace function public.hr_checklist_access(p_employee uuid)
returns text
language plpgsql
stable
security definer
set search_path = hr, public
as $$
declare
  v_allowed boolean;
begin
  if not public.is_active_user() then
    return 'none';
  end if;
  if p_employee is null then
    if hr.is_director() or public.workspace_is_admin() then
      return case when hr.aal_ok() then 'all' else 'mfa' end;
    end if;
    if exists (select 1 from hr.employees e where hr.checklist_reports(e.id)) then
      return case when hr.aal_ok() then 'reports' else 'mfa' end;
    end if;
    return 'none';
  end if;
  v_allowed := hr.is_director() or public.workspace_is_admin() or hr.checklist_reports(p_employee);
  if not v_allowed then
    return 'none';
  end if;
  if not hr.aal_ok() then
    return 'mfa';
  end if;
  return 'edit';
end;
$$;

create or replace function public.hr_create_joiner(
  p_full_name text,
  p_preferred_name text,
  p_work_email text,
  p_phone text,
  p_job_title text,
  p_department text,
  p_location text,
  p_start_date date,
  p_manager_id uuid,
  p_contract_type text,
  p_hours_per_week numeric,
  p_notice_period text,
  p_engineer_resource_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = hr, public, ops
as $$
declare
  v_access text;
  v_name text;
  v_preferred text;
  v_email text;
  v_phone text;
  v_title text;
  v_department text;
  v_contract text;
  v_notice text;
  v_location text;
  v_id uuid;
begin
  v_access := public.hr_checklist_access(null);
  if v_access = 'mfa' then
    raise exception 'app: Turn on two-step sign-in to open this.';
  end if;
  if v_access is distinct from 'all' then
    raise exception 'app: You cannot add a joiner.';
  end if;
  v_name := regexp_replace(btrim(coalesce(p_full_name, '')), '[[:space:]]+', ' ', 'g');
  if v_name = '' or char_length(v_name) > 160 then
    raise exception 'app: Enter the person''s name.';
  end if;
  v_location := lower(btrim(coalesce(p_location, '')));
  if v_location not in ('office', 'warehouse', 'field') then
    raise exception 'app: Choose a location.';
  end if;
  if p_start_date is null then
    raise exception 'app: Check the start date.';
  end if;
  v_email := nullif(lower(btrim(coalesce(p_work_email, ''))), '');
  if v_email is not null and v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'app: Check the work email.';
  end if;
  if p_hours_per_week is not null and (p_hours_per_week < 0 or p_hours_per_week > 80) then
    raise exception 'app: Check the hours.';
  end if;
  v_preferred := nullif(regexp_replace(btrim(coalesce(p_preferred_name, '')), '[[:space:]]+', ' ', 'g'), '');
  v_phone := nullif(btrim(coalesce(p_phone, '')), '');
  v_title := nullif(btrim(coalesce(p_job_title, '')), '');
  v_department := nullif(btrim(coalesce(p_department, '')), '');
  v_contract := nullif(btrim(coalesce(p_contract_type, '')), '');
  v_notice := nullif(btrim(coalesce(p_notice_period, '')), '');
  if char_length(coalesce(v_preferred, '')) > 160
     or char_length(coalesce(v_phone, '')) > 40
     or char_length(coalesce(v_title, '')) > 120
     or char_length(coalesce(v_department, '')) > 120
     or char_length(coalesce(v_contract, '')) > 80
     or char_length(coalesce(v_notice, '')) > 80
  then
    raise exception 'app: That is too long.';
  end if;
  if p_manager_id is not null and not exists (select 1 from hr.employees where id = p_manager_id) then
    raise exception 'app: Choose a line manager.';
  end if;
  if p_engineer_resource_id is not null then
    if v_location <> 'field' then
      raise exception 'app: Install engineers are field staff.';
    end if;
    if not exists (
      select 1 from ops.resources
      where id = p_engineer_resource_id
        and status = 'active'
        and resource_type in ('installer', 'helper')
    ) then
      raise exception 'app: That engineer record cannot be linked.';
    end if;
    if exists (select 1 from hr.employees where engineer_resource_id = p_engineer_resource_id) then
      raise exception 'app: That engineer record is already linked.';
    end if;
  end if;
  insert into hr.employees (
    full_name, preferred_name, work_email, phone, job_title, department,
    location, start_date, manager_id, status, engineer_resource_id
  ) values (
    v_name, v_preferred, v_email, v_phone, v_title, v_department,
    v_location, p_start_date, p_manager_id, 'active', p_engineer_resource_id
  )
  returning id into v_id;
  insert into hr.employment_terms (employee_id, contract_type, hours_per_week, notice_period, effective_from)
  values (v_id, v_contract, p_hours_per_week, v_notice, p_start_date);
  perform hr.open_checklist(v_id, 'onboarding', p_start_date, v_location, auth.uid());
  return v_id;
end;
$$;

create or replace function public.hr_start_leaving(p_employee uuid, p_end_date date, p_name text)
returns uuid
language plpgsql
security definer
set search_path = hr, public
as $$
declare
  v_access text;
  v_row hr.employees;
  v_given text;
  v_id uuid;
begin
  v_access := public.hr_checklist_access(p_employee);
  if v_access = 'mfa' then
    raise exception 'app: Turn on two-step sign-in to open this.';
  end if;
  if v_access is distinct from 'edit' then
    raise exception 'app: You cannot start leaving for that person.';
  end if;
  select * into v_row from hr.employees where id = p_employee;
  if not found then
    raise exception 'app: That person is not here.';
  end if;
  v_given := regexp_replace(btrim(coalesce(p_name, '')), '[[:space:]]+', ' ', 'g');
  if lower(v_given) is distinct from lower(v_row.full_name) then
    raise exception 'app: Confirm the person''s name.';
  end if;
  if v_row.status = 'leaver' then
    raise exception 'app: Leaving has already started.';
  end if;
  if p_end_date is null then
    raise exception 'app: Check the leave date.';
  end if;
  if v_row.start_date is not null and p_end_date < v_row.start_date then
    raise exception 'app: The leave date is before the start date.';
  end if;
  update hr.employees
  set end_date = p_end_date, status = 'leaver'
  where id = p_employee and status = 'active';
  if not found then
    raise exception 'app: Leaving has already started.';
  end if;
  v_id := hr.open_checklist(
    p_employee,
    'offboarding',
    p_end_date,
    coalesce(v_row.location, 'office'),
    auth.uid()
  );
  return v_id;
end;
$$;

create or replace function public.hr_set_checklist_item(p_item uuid, p_done boolean)
returns void
language plpgsql
security definer
set search_path = hr, public
as $$
declare
  v_item hr.checklist_items;
  v_employee uuid;
  v_status text;
  v_access text;
begin
  select i.* into v_item from hr.checklist_items i where i.id = p_item;
  if not found then
    raise exception 'app: That item is not here.';
  end if;
  select c.employee_id, c.status into v_employee, v_status
  from hr.checklists c
  where c.id = v_item.checklist_id;
  v_access := public.hr_checklist_access(v_employee);
  if v_access is distinct from 'edit' then
    raise exception 'app: That item is not here.';
  end if;
  if v_status = 'cancelled' then
    raise exception 'app: That checklist is cancelled.';
  end if;
  if coalesce(p_done, false) then
    update hr.checklist_items
    set done_at = coalesce(done_at, now()), done_by = coalesce(done_by, auth.uid())
    where id = p_item and done_at is null;
  else
    update hr.checklist_items
    set done_at = null, done_by = null
    where id = p_item and done_at is not null;
  end if;
  perform hr.refresh_checklist_status(v_item.checklist_id);
end;
$$;

create or replace function public.hr_open_checklists()
returns table (
  id uuid,
  employee_id uuid,
  full_name text,
  kind text,
  due_on date,
  open_items integer
)
language sql
stable
security definer
set search_path = hr, public
as $$
  select c.id, c.employee_id, e.full_name, c.kind, c.due_on,
    (
      select count(*)::integer
      from hr.checklist_items i
      where i.checklist_id = c.id and i.done_at is null
    ) as open_items
  from hr.checklists c
  join hr.employees e on e.id = c.employee_id
  where c.status = 'open'
    and hr.checklist_visible(c.employee_id)
  order by c.due_on nulls last, e.full_name, c.kind;
$$;

create or replace function public.hr_manager_options()
returns table (id uuid, full_name text)
language sql
stable
security definer
set search_path = hr, public
as $$
  select e.id, e.full_name
  from hr.employees e
  where e.status = 'active'
    and public.hr_checklist_access(null) = 'all'
  order by e.full_name
  limit 200;
$$;

create or replace function public.hr_person_checklists(p_employee uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = hr, public
as $$
declare
  v_access text;
  v_emp hr.employees;
  v_lists jsonb;
begin
  if p_employee is null or not public.is_active_user() then
    return jsonb_build_object('access', 'none', 'employee', null, 'checklists', '[]'::jsonb);
  end if;
  v_access := public.hr_checklist_access(p_employee);
  if v_access is distinct from 'edit' then
    return jsonb_build_object('access', coalesce(v_access, 'none'), 'employee', null, 'checklists', '[]'::jsonb);
  end if;
  select * into v_emp from hr.employees where id = p_employee;
  if not found then
    return jsonb_build_object('access', 'none', 'employee', null, 'checklists', '[]'::jsonb);
  end if;
  select coalesce(jsonb_agg(item order by item ->> 'due_on', item ->> 'kind'), '[]'::jsonb)
    into v_lists
  from (
    select jsonb_build_object(
      'id', c.id,
      'kind', c.kind,
      'status', c.status,
      'due_on', c.due_on,
      'items', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', i.id,
          'label', i.label,
          'owner', i.owner,
          'due_on', i.due_on,
          'done_at', i.done_at,
          'link_kind', i.link_kind
        ) order by i.position), '[]'::jsonb)
        from hr.checklist_items i
        where i.checklist_id = c.id
      )
    ) as item
    from hr.checklists c
    where c.employee_id = p_employee
  ) lists;
  return jsonb_build_object(
    'access', 'edit',
    'employee', jsonb_build_object(
      'id', v_emp.id,
      'full_name', v_emp.full_name,
      'job_title', v_emp.job_title,
      'department', v_emp.department,
      'location', v_emp.location,
      'work_email', v_emp.work_email,
      'phone', v_emp.phone,
      'start_date', v_emp.start_date,
      'end_date', v_emp.end_date,
      'status', v_emp.status,
      'profile_id', v_emp.profile_id,
      'engineer_resource_id', v_emp.engineer_resource_id,
      'contract_type', (
        select t.contract_type from hr.employment_terms t
        where t.employee_id = v_emp.id
        order by t.effective_from, t.created_at
        limit 1
      ),
      'hours_per_week', (
        select t.hours_per_week from hr.employment_terms t
        where t.employee_id = v_emp.id
        order by t.effective_from, t.created_at
        limit 1
      ),
      'notice_period', (
        select t.notice_period from hr.employment_terms t
        where t.employee_id = v_emp.id
        order by t.effective_from, t.created_at
        limit 1
      )
    ),
    'checklists', v_lists
  );
end;
$$;

create trigger checklist_templates_touch
before update on hr.checklist_templates
for each row execute function public.touch_updated_at();

create trigger checklists_touch
before update on hr.checklists
for each row execute function public.touch_updated_at();

create trigger checklist_templates_audit
after insert or update or delete on hr.checklist_templates
for each row execute function hr.audit_row_change();

create trigger checklists_audit
after insert or update or delete on hr.checklists
for each row execute function hr.audit_row_change();

create trigger checklist_items_audit
after insert or update or delete on hr.checklist_items
for each row execute function hr.audit_row_change();

insert into hr.checklist_templates (kind, name, items, active)
select 'onboarding', 'Joiner', $onboarding$[
  {"label":"Contract issued","owner":"hr","offset_days":0,"link_kind":"none"},
  {"label":"Right to work checked","owner":"hr","offset_days":0,"link_kind":"none"},
  {"label":"Pulse login invited","owner":"hr","offset_days":1,"link_kind":"pulse_invite"},
  {"label":"Teams set","owner":"it","offset_days":1,"link_kind":"teams"},
  {"label":"Line manager set","owner":"manager","offset_days":0,"link_kind":"none"},
  {"label":"H&S induction","owner":"operations","offset_days":5,"link_kind":"none"},
  {"label":"Kit issued","owner":"operations","offset_days":5,"link_kind":"none"},
  {"label":"Engineer record","owner":"operations","offset_days":1,"link_kind":"engineer_record","field_only":true}
]$onboarding$::jsonb, true
where not exists (
  select 1 from hr.checklist_templates where kind = 'onboarding' and active
);

insert into hr.checklist_templates (kind, name, items, active)
select 'offboarding', 'Leaver', $offboarding$[
  {"label":"Leave date confirmed","owner":"manager","offset_days":0,"link_kind":"none"},
  {"label":"Holiday balance settled","owner":"hr","offset_days":-5,"link_kind":"none"},
  {"label":"Kit returned","owner":"operations","offset_days":0,"link_kind":"none"},
  {"label":"Pulse login deactivated","owner":"it","offset_days":0,"link_kind":"deactivate_login"},
  {"label":"Engineer record inactive","owner":"operations","offset_days":0,"link_kind":"engineer_record","field_only":true},
  {"label":"Exit chat","owner":"manager","offset_days":-1,"link_kind":"none"}
]$offboarding$::jsonb, true
where not exists (
  select 1 from hr.checklist_templates where kind = 'offboarding' and active
);

create or replace view public.hr_checklist_templates
with (security_barrier = true, security_invoker = true) as
select id, kind, name, items, active, created_at, updated_at
from hr.checklist_templates;

create or replace view public.hr_checklists
with (security_barrier = true, security_invoker = true) as
select id, employee_id, kind, template_id, status, due_on, created_by, created_at, updated_at
from hr.checklists;

create or replace view public.hr_checklist_items
with (security_barrier = true, security_invoker = true) as
select id, checklist_id, label, owner, due_on, done_at, done_by, link_kind, position, created_at
from hr.checklist_items;

revoke all on table public.hr_checklist_templates, public.hr_checklists, public.hr_checklist_items from public, anon, authenticated;
grant select on table public.hr_checklist_templates, public.hr_checklists, public.hr_checklist_items to authenticated, service_role;

revoke all on function hr.checklist_reports(uuid) from public, anon, authenticated;
revoke all on function hr.checklist_visible(uuid) from public, anon;
revoke all on function hr.shift_due(date, integer) from public, anon, authenticated;
revoke all on function hr.template_items(uuid, text) from public, anon, authenticated;
revoke all on function hr.refresh_checklist_status(uuid) from public, anon, authenticated;
revoke all on function hr.open_checklist(uuid, text, date, text, uuid) from public, anon, authenticated;
grant execute on function hr.checklist_reports(uuid) to postgres;
grant execute on function hr.checklist_visible(uuid) to postgres, authenticated, service_role;
grant execute on function hr.shift_due(date, integer) to postgres;
grant execute on function hr.template_items(uuid, text) to postgres;
grant execute on function hr.refresh_checklist_status(uuid) to postgres;
grant execute on function hr.open_checklist(uuid, text, date, text, uuid) to postgres;

revoke all on function public.hr_checklist_access(uuid) from public, anon;
revoke all on function public.hr_create_joiner(text, text, text, text, text, text, text, date, uuid, text, numeric, text, uuid) from public, anon;
revoke all on function public.hr_start_leaving(uuid, date, text) from public, anon;
revoke all on function public.hr_set_checklist_item(uuid, boolean) from public, anon;
revoke all on function public.hr_open_checklists() from public, anon;
revoke all on function public.hr_manager_options() from public, anon;
revoke all on function public.hr_person_checklists(uuid) from public, anon;

grant execute on function public.hr_checklist_access(uuid) to authenticated, service_role;
grant execute on function public.hr_create_joiner(text, text, text, text, text, text, text, date, uuid, text, numeric, text, uuid) to authenticated, service_role;
grant execute on function public.hr_start_leaving(uuid, date, text) to authenticated, service_role;
grant execute on function public.hr_set_checklist_item(uuid, boolean) to authenticated, service_role;
grant execute on function public.hr_open_checklists() to authenticated, service_role;
grant execute on function public.hr_manager_options() to authenticated, service_role;
grant execute on function public.hr_person_checklists(uuid) to authenticated, service_role;
