-- HR Pulse Phase 1. Records, absence, cases, and the tables Phase 3 will use.
-- New file only. Do not apply to production.

create schema if not exists hr;

revoke all on schema hr from public, anon;
grant usage on schema hr to authenticated, service_role;

create table hr.settings (
  id boolean primary key default true check (id),
  leave_year_start_month integer not null default 5 check (leave_year_start_month between 1 and 12),
  leave_year_start_day integer not null default 1 check (leave_year_start_day between 1 and 28),
  bank_holiday_rule text not null default 'on_top' check (bank_holiday_rule in ('on_top', 'inside')),
  bank_holiday_region text not null default 'england-and-wales',
  default_allowance_days numeric not null default 20 check (default_allowance_days >= 0),
  carry_over_cap_days numeric not null default 5 check (carry_over_cap_days >= 0),
  survey_min_responses integer not null default 5 check (survey_min_responses >= 1),
  inbound_email_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

insert into hr.settings (id) values (true);

create table hr.directors (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table hr.employees (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid unique references public.profiles (id) on delete set null,
  full_name text not null check (char_length(trim(full_name)) between 1 and 160),
  preferred_name text,
  work_email text,
  personal_email text,
  phone text,
  home_address jsonb,
  date_of_birth date,
  start_date date,
  end_date date,
  job_title text,
  department text,
  location text check (location is null or location in ('office', 'warehouse', 'field')),
  manager_id uuid references hr.employees (id) on delete set null,
  status text not null default 'active' check (status in ('active', 'leaver')),
  role_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date is null or start_date is null or end_date >= start_date),
  check (manager_id is distinct from id)
);

create table hr.employment_terms (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references hr.employees (id) on delete cascade,
  contract_type text,
  hours_per_week numeric,
  days_per_week numeric,
  notice_period text,
  probation_end date,
  effective_from date not null,
  created_at timestamptz not null default now()
);

create table hr.salaries (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references hr.employees (id) on delete cascade,
  amount numeric not null,
  pay_basis text not null check (pay_basis in ('annual', 'hourly')),
  effective_from date not null,
  reason text,
  approved_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create table hr.right_to_work (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references hr.employees (id) on delete cascade,
  check_type text not null,
  checked_on date not null,
  checked_by uuid references public.profiles (id) on delete set null,
  file_id uuid,
  expires_on date,
  follow_up_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table hr.emergency_contacts (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references hr.employees (id) on delete cascade,
  name text not null,
  relationship text,
  phone_primary text,
  phone_secondary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table hr.change_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references hr.employees (id) on delete cascade,
  field_key text not null check (field_key in ('phone', 'personal_email', 'home_address', 'emergency_contacts', 'preferred_name')),
  old_value jsonb,
  new_value jsonb,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  submitted_by uuid references public.profiles (id) on delete set null,
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table hr.leave_allowances (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references hr.employees (id) on delete cascade,
  leave_year_start date not null,
  entitlement_days numeric not null,
  carried_over_days numeric not null default 0,
  bank_holiday_rule_snapshot text not null check (bank_holiday_rule_snapshot in ('on_top', 'inside')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employee_id, leave_year_start)
);

create table hr.bank_holidays (
  id uuid primary key default gen_random_uuid(),
  region text not null,
  holiday_on date not null,
  title text not null,
  unique (region, holiday_on)
);

create table hr.leave_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references hr.employees (id) on delete cascade,
  starts_on date not null,
  ends_on date not null,
  start_half boolean not null default false,
  end_half boolean not null default false,
  days numeric not null check (days >= 0),
  kind text not null default 'annual' check (kind in ('annual', 'unpaid', 'other')),
  status text not null default 'requested' check (status in ('requested', 'approved', 'declined', 'cancelled')),
  approver_id uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on >= starts_on)
);

create table hr.sickness (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references hr.employees (id) on delete cascade,
  starts_on date not null,
  ends_on date,
  days_lost numeric,
  reason_category text,
  fit_note_file_id uuid,
  rtw_note text,
  rtw_by uuid references public.profiles (id) on delete set null,
  status text not null default 'open' check (status in ('open', 'returned', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table hr.cases (
  id uuid primary key default gen_random_uuid(),
  case_type text not null check (case_type in ('disciplinary', 'grievance', 'performance', 'health', 'flexible_working')),
  subject_employee_id uuid not null references hr.employees (id) on delete restrict,
  title text not null,
  route text not null check (route in ('manager', 'director_only')),
  stage text not null,
  outcome text,
  decision_due_on date,
  opened_by uuid references public.profiles (id) on delete set null,
  closed_at timestamptz,
  retention_until date,
  inbound_token_hash text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table hr.case_members (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references hr.cases (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  member_role text not null check (member_role in ('owner', 'member', 'hr_partner')),
  added_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (case_id, profile_id)
);

create table hr.external_partners (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  organisation text,
  created_at timestamptz not null default now()
);

create table hr.case_entries (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references hr.cases (id) on delete cascade,
  kind text not null check (kind in ('note', 'email', 'letter', 'meeting', 'stage_change', 'outcome')),
  author_id uuid references public.profiles (id) on delete set null,
  occurred_at timestamptz not null default now(),
  body text,
  email_from text,
  email_subject text,
  created_at timestamptz not null default now()
);

create table hr.files (
  id uuid primary key default gen_random_uuid(),
  bucket text not null default 'hr-private' check (bucket = 'hr-private'),
  storage_path text not null,
  employee_id uuid references hr.employees (id) on delete cascade,
  case_id uuid references hr.cases (id) on delete cascade,
  kind text not null,
  retention_until date,
  uploaded_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (bucket, storage_path)
);

alter table hr.right_to_work
  add constraint right_to_work_file_fk foreign key (file_id) references hr.files (id) on delete set null;
alter table hr.sickness
  add constraint sickness_fit_note_fk foreign key (fit_note_file_id) references hr.files (id) on delete set null;

create table hr.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles (id) on delete set null,
  actor_kind text not null default 'user' check (actor_kind in ('user', 'system', 'token', 'cron')),
  module_id text,
  entity_schema text not null,
  entity_table text not null,
  entity_id uuid,
  action text not null,
  field_name text,
  old_value jsonb,
  new_value jsonb,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index hr_audit_entity_idx on hr.audit_log (entity_schema, entity_table, entity_id, created_at desc);

create table hr.courses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  renewal_months integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table hr.course_requirements (
  id uuid primary key default gen_random_uuid(),
  role_key text not null,
  course_id uuid not null references hr.courses (id) on delete cascade,
  unique (role_key, course_id)
);

create table hr.training_records (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references hr.employees (id) on delete cascade,
  course_id uuid not null references hr.courses (id) on delete restrict,
  completed_on date,
  provider text,
  certificate_file_id uuid references hr.files (id) on delete set null,
  expires_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table hr.surveys (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  anonymous boolean not null default true,
  min_responses integer not null default 5,
  opens_on date,
  closes_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table hr.survey_questions (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references hr.surveys (id) on delete cascade,
  prompt text not null,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create table hr.survey_responses (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references hr.surveys (id) on delete cascade,
  team_key text,
  answer jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table hr.survey_invites (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references hr.surveys (id) on delete cascade,
  employee_id uuid not null references hr.employees (id) on delete cascade,
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  unique (survey_id, employee_id)
);

insert into storage.buckets (id, name, public, file_size_limit)
values ('hr-private', 'hr-private', false, 20971520)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

create or replace function hr.mask_row(p_table text, p_row jsonb)
returns jsonb
language plpgsql
immutable
as $$
begin
  if p_row is null then return null; end if;
  if p_table = 'salaries' and p_row ? 'amount' then
    p_row := jsonb_set(p_row, '{amount}', '"***"'::jsonb);
  end if;
  if p_table = 'employees' and p_row ? 'date_of_birth' then
    p_row := jsonb_set(p_row, '{date_of_birth}', '"***"'::jsonb);
  end if;
  return p_row;
end;
$$;

create or replace function hr.mask_value(p_table text, p_field text, p_value jsonb)
returns jsonb
language sql
immutable
as $$
  select case
    when p_table = 'salaries' and p_field = 'amount' then '"***"'::jsonb
    when p_table = 'employees' and p_field = 'date_of_birth' then '"***"'::jsonb
    else p_value
  end;
$$;

create or replace function hr.prevent_audit_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'hr.audit_log is immutable';
end;
$$;

create trigger hr_audit_immutable
before update or delete on hr.audit_log
for each row execute function hr.prevent_audit_mutation();

create or replace function hr.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = hr, public
as $$
declare
  v_actor uuid := auth.uid();
  v_old jsonb;
  v_new jsonb;
  v_key text;
  v_entity uuid;
begin
  if tg_op = 'DELETE' then
    v_old := hr.mask_row(tg_table_name, to_jsonb(old));
    v_entity := coalesce(nullif(v_old->>'id', '')::uuid, nullif(v_old->>'profile_id', '')::uuid);
    insert into hr.audit_log (actor_id, module_id, entity_schema, entity_table, entity_id, action, old_value)
    values (v_actor, 'people', 'hr', tg_table_name, v_entity, 'delete', v_old);
    return old;
  end if;
  v_new := to_jsonb(new);
  v_entity := coalesce(nullif(v_new->>'id', '')::uuid, nullif(v_new->>'profile_id', '')::uuid);
  if tg_op = 'INSERT' then
    insert into hr.audit_log (actor_id, module_id, entity_schema, entity_table, entity_id, action, new_value)
    values (v_actor, 'people', 'hr', tg_table_name, v_entity, 'insert', hr.mask_row(tg_table_name, v_new));
    return new;
  end if;
  v_old := to_jsonb(old);
  for v_key in select jsonb_object_keys(v_new)
  loop
    if v_key in ('updated_at', 'created_at') then continue; end if;
    if (v_old -> v_key) is distinct from (v_new -> v_key) then
      insert into hr.audit_log (actor_id, module_id, entity_schema, entity_table, entity_id, action, field_name, old_value, new_value)
      values (
        v_actor, 'people', 'hr', tg_table_name, v_entity,
        case when v_key = 'status' then 'status' else 'update' end,
        v_key,
        hr.mask_value(tg_table_name, v_key, v_old -> v_key),
        hr.mask_value(tg_table_name, v_key, v_new -> v_key)
      );
    end if;
  end loop;
  return new;
end;
$$;

create or replace function hr.prevent_append_change()
returns trigger
language plpgsql
as $$
begin
  raise exception 'app: That record cannot be changed.';
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array ARRAY[
    'settings', 'employees', 'right_to_work', 'emergency_contacts', 'change_requests',
    'leave_allowances', 'leave_requests', 'sickness', 'cases', 'courses', 'training_records', 'surveys'
  ]
  loop
    execute format('create trigger %I before update on hr.%I for each row execute function public.touch_updated_at()', t || '_touch', t);
    execute format('create trigger %I after insert or update or delete on hr.%I for each row execute function hr.audit_row_change()', t || '_audit', t);
  end loop;
  foreach t in array ARRAY['employment_terms', 'salaries', 'case_entries', 'directors', 'case_members', 'files', 'bank_holidays', 'external_partners']
  loop
    execute format('create trigger %I after insert or update or delete on hr.%I for each row execute function hr.audit_row_change()', t || '_audit', t);
  end loop;
end
$$;

create trigger employment_terms_append before update or delete on hr.employment_terms
for each row execute function hr.prevent_append_change();
create trigger salaries_append before update or delete on hr.salaries
for each row execute function hr.prevent_append_change();
create trigger case_entries_append before update or delete on hr.case_entries
for each row execute function hr.prevent_append_change();

create or replace function hr.current_employee_id()
returns uuid
language sql
stable
security definer
set search_path = hr, public
as $$
  select e.id from hr.employees e where e.profile_id = auth.uid() order by e.created_at limit 1;
$$;

create or replace function hr.is_director()
returns boolean
language sql
stable
security definer
set search_path = hr, public
as $$
  select public.is_active_user() and (
    exists (select 1 from hr.directors d where d.profile_id = auth.uid())
    or public.is_admin()
    or public.workspace_is_admin()
  );
$$;

create or replace function hr.manages(p_employee uuid)
returns boolean
language sql
stable
security definer
set search_path = hr, public
as $$
  select exists (
    select 1
    from hr.employees report
    join hr.employees manager on manager.id = report.manager_id
    where report.id = p_employee
      and manager.profile_id = auth.uid()
  );
$$;

create or replace function hr.manages_chain(p_employee uuid)
returns boolean
language sql
stable
security definer
set search_path = hr, public
as $$
  with recursive up as (
    select manager_id as id
    from hr.employees
    where id = p_employee and manager_id is not null
    union all
    select e.manager_id
    from hr.employees e
    join up on e.id = up.id
    where e.manager_id is not null
  )
  select exists (
    select 1 from up
    join hr.employees manager on manager.id = up.id
    where manager.profile_id = auth.uid()
  );
$$;

create or replace function hr.chain_profile_ids(p_employee uuid)
returns setof uuid
language sql
stable
security definer
set search_path = hr, public
as $$
  with recursive up as (
    select manager_id as id
    from hr.employees
    where id = p_employee and manager_id is not null
    union all
    select e.manager_id
    from hr.employees e
    join up on e.id = up.id
    where e.manager_id is not null
  )
  select manager.profile_id
  from up
  join hr.employees manager on manager.id = up.id
  where manager.profile_id is not null;
$$;

create or replace function hr.is_self(p_employee uuid)
returns boolean
language sql
stable
security definer
set search_path = hr, public
as $$
  select exists (select 1 from hr.employees e where e.id = p_employee and e.profile_id = auth.uid());
$$;

create or replace function hr.can_view_employee(p_employee uuid)
returns boolean
language sql
stable
security definer
set search_path = hr, public
as $$
  select public.is_active_user() and (
    hr.is_self(p_employee) or hr.manages(p_employee) or hr.is_director()
  );
$$;

create or replace function hr.can_edit_employee(p_employee uuid)
returns boolean
language sql
stable
security definer
set search_path = hr, public
as $$
  select public.is_active_user() and (hr.manages(p_employee) or hr.is_director());
$$;

create or replace function hr.can_view_salary(p_employee uuid)
returns boolean
language sql
stable
security definer
set search_path = hr, public
as $$
  select hr.can_view_employee(p_employee);
$$;

create or replace function hr.is_case_member(p_case uuid)
returns boolean
language sql
stable
security definer
set search_path = hr, public
as $$
  select exists (
    select 1 from hr.case_members m
    where m.case_id = p_case and m.profile_id = auth.uid()
  );
$$;

create or replace function hr.aal_ok()
returns boolean
language sql
stable
as $$
  select coalesce(auth.jwt()->>'aal', '') = 'aal2' or coalesce(auth.role(), '') = 'service_role';
$$;

create or replace function hr.require_mfa()
returns void
language plpgsql
stable
as $$
begin
  if coalesce(auth.role(), '') = 'service_role' then return; end if;
  if coalesce(auth.jwt()->>'aal', '') = 'aal2' then return; end if;
  raise exception 'app: Turn on two-step sign-in to open this.';
end;
$$;

create or replace function hr.working_days(
  p_start date,
  p_end date,
  p_start_half boolean,
  p_end_half boolean,
  p_region text
)
returns numeric
language plpgsql
stable
set search_path = hr, public
as $$
declare
  v_day date;
  v_count numeric := 0;
  v_first date;
  v_last date;
begin
  if p_end < p_start then return 0; end if;
  v_day := p_start;
  while v_day <= p_end loop
    if extract(isodow from v_day) < 6
       and not exists (select 1 from hr.bank_holidays b where b.region = p_region and b.holiday_on = v_day)
    then
      v_count := v_count + 1;
      v_first := coalesce(v_first, v_day);
      v_last := v_day;
    end if;
    v_day := v_day + 1;
  end loop;
  if v_count = 0 then return 0; end if;
  if p_start = p_end then
    return case when p_start_half or p_end_half then 0.5 else 1 end;
  end if;
  if p_start_half and v_first = p_start then v_count := v_count - 0.5; end if;
  if p_end_half and v_last = p_end then v_count := v_count - 0.5; end if;
  return greatest(v_count, 0);
end;
$$;

do $$
declare
  t text;
begin
  for t in
    select tablename from pg_tables where schemaname = 'hr'
  loop
    execute format('alter table hr.%I enable row level security', t);
    execute format('revoke all on hr.%I from public, anon, authenticated', t);
    execute format('grant all on hr.%I to service_role', t);
  end loop;
end
$$;

revoke all on function hr.current_employee_id() from public, anon;
revoke all on function hr.is_director() from public, anon;
revoke all on function hr.manages(uuid) from public, anon;
revoke all on function hr.manages_chain(uuid) from public, anon;
revoke all on function hr.can_view_employee(uuid) from public, anon;
revoke all on function hr.can_edit_employee(uuid) from public, anon;
revoke all on function hr.can_view_salary(uuid) from public, anon;
revoke all on function hr.is_case_member(uuid) from public, anon;
revoke all on function hr.require_mfa() from public, anon;
grant execute on function hr.current_employee_id() to authenticated, service_role;
grant execute on function hr.is_director() to authenticated, service_role;
grant execute on function hr.manages(uuid) to authenticated, service_role;
grant execute on function hr.manages_chain(uuid) to authenticated, service_role;
grant execute on function hr.can_view_employee(uuid) to authenticated, service_role;
grant execute on function hr.can_edit_employee(uuid) to authenticated, service_role;
grant execute on function hr.can_view_salary(uuid) to authenticated, service_role;
grant execute on function hr.is_case_member(uuid) to authenticated, service_role;
grant execute on function hr.require_mfa() to authenticated, service_role;
