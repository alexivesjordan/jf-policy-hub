-- Org chart: companies, positions, and day-to-day leads.
-- manager_id stays. A trigger fills it from the position above.
-- New file only. Do not apply to production.

create table core.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(trim(name)) between 1 and 120)
);

insert into core.companies (name) values ('Jordan Fitness'), ('Jordan Metalwork');

alter table hr.employees
  add column company_id uuid references core.companies (id) on delete set null,
  add column lead_id uuid references hr.employees (id) on delete set null,
  add column position_id uuid;

alter table hr.employees
  add constraint employees_lead_not_self check (lead_id is distinct from id);

update hr.employees
set company_id = (select id from core.companies where name = 'Jordan Fitness')
where company_id is null;

create table hr.positions (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(trim(title)) between 1 and 120),
  reports_to_position_id uuid references hr.positions (id) on delete set null,
  company_id uuid references core.companies (id) on delete set null,
  allow_multiple boolean not null default false,
  archived_at timestamptz,
  check (reports_to_position_id is distinct from id)
);

create table hr.position_holders (
  position_id uuid not null references hr.positions (id) on delete cascade,
  employee_id uuid not null references hr.employees (id) on delete cascade,
  from_date date not null default current_date,
  to_date date,
  primary key (position_id, employee_id, from_date),
  check (to_date is null or to_date >= from_date)
);

alter table hr.employees
  add constraint employees_position_fk foreign key (position_id) references hr.positions (id) on delete set null;

insert into hr.positions (title, allow_multiple, company_id)
select 'Directors', true, id from core.companies where name = 'Jordan Fitness';

create or replace function hr.position_has_holder(p_position uuid)
returns boolean
language sql
stable
security definer
set search_path = hr, public
as $$
  select exists (
    select 1 from hr.position_holders h
    where h.position_id = p_position and h.to_date is null
  );
$$;

create or replace function hr.resolved_manager_position(p_position uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = hr, public
as $$
declare
  v_id uuid;
  v_guard integer := 0;
begin
  select reports_to_position_id into v_id
  from hr.positions
  where id = p_position and archived_at is null;
  while v_id is not null and v_guard < 30 loop
    if hr.position_has_holder(v_id) then
      return v_id;
    end if;
    select reports_to_position_id into v_id from hr.positions where id = v_id;
    v_guard := v_guard + 1;
  end loop;
  return null;
end;
$$;

create or replace function hr.primary_manager(p_position uuid)
returns uuid
language sql
stable
security definer
set search_path = hr, public
as $$
  select h.employee_id
  from hr.position_holders h
  where h.position_id = hr.resolved_manager_position(p_position)
    and h.to_date is null
  order by h.from_date, h.employee_id
  limit 1;
$$;

create or replace function hr.sync_manager_ids()
returns void
language plpgsql
security definer
set search_path = hr, public
as $$
begin
  update hr.employees e
  set manager_id = hr.primary_manager(e.position_id)
  where e.position_id is not null
    and e.manager_id is distinct from hr.primary_manager(e.position_id);
end;
$$;

create or replace function hr.touch_org_managers()
returns trigger
language plpgsql
security definer
set search_path = hr, public
as $$
begin
  perform hr.sync_manager_ids();
  return null;
end;
$$;

create trigger position_holders_sync_managers
after insert or update or delete on hr.position_holders
for each statement execute function hr.touch_org_managers();

create trigger positions_sync_managers
after update of reports_to_position_id, archived_at on hr.positions
for each statement execute function hr.touch_org_managers();

create or replace function hr.employees_apply_position()
returns trigger
language plpgsql
security definer
set search_path = hr, public
as $$
begin
  if new.position_id is not null then
    new.manager_id := hr.primary_manager(new.position_id);
  end if;
  if new.lead_id = new.id then
    raise exception 'app: A person cannot lead themself.';
  end if;
  return new;
end;
$$;

create trigger employees_apply_position
before insert or update of position_id, lead_id on hr.employees
for each row execute function hr.employees_apply_position();

create or replace function hr.reject_position_cycle()
returns trigger
language plpgsql
security definer
set search_path = hr, public
as $$
declare
  v_id uuid := new.reports_to_position_id;
  v_guard integer := 0;
begin
  if v_id is null then
    return new;
  end if;
  if v_id = new.id then
    raise exception 'app: A seat cannot report to itself.';
  end if;
  while v_id is not null and v_guard < 30 loop
    if v_id = new.id then
      raise exception 'app: That would make a reporting loop.';
    end if;
    select reports_to_position_id into v_id from hr.positions where id = v_id;
    v_guard := v_guard + 1;
  end loop;
  return new;
end;
$$;

create trigger positions_reject_cycle
before insert or update of reports_to_position_id on hr.positions
for each row execute function hr.reject_position_cycle();

create or replace function hr.reject_extra_holder()
returns trigger
language plpgsql
security definer
set search_path = hr, public
as $$
declare
  v_multiple boolean;
begin
  if new.to_date is not null then
    return new;
  end if;
  select allow_multiple into v_multiple from hr.positions where id = new.position_id;
  if coalesce(v_multiple, false) then
    return new;
  end if;
  if exists (
    select 1 from hr.position_holders h
    where h.position_id = new.position_id
      and h.to_date is null
      and h.employee_id <> new.employee_id
  ) then
    raise exception 'app: That seat already has a person.';
  end if;
  return new;
end;
$$;

create trigger position_holders_one_seat
before insert or update of to_date, employee_id on hr.position_holders
for each row execute function hr.reject_extra_holder();

create or replace function hr.leads(p_employee uuid)
returns boolean
language sql
stable
security definer
set search_path = hr, public
as $$
  select public.is_active_user() and exists (
    select 1
    from hr.employees subject
    join hr.employees lead on lead.id = subject.lead_id
    where subject.id = p_employee
      and lead.profile_id = auth.uid()
  );
$$;

revoke all on function hr.position_has_holder(uuid) from public, anon;
revoke all on function hr.resolved_manager_position(uuid) from public, anon;
revoke all on function hr.primary_manager(uuid) from public, anon;
revoke all on function hr.sync_manager_ids() from public, anon;
revoke all on function hr.leads(uuid) from public, anon;
grant execute on function hr.position_has_holder(uuid) to authenticated, service_role;
grant execute on function hr.resolved_manager_position(uuid) to authenticated, service_role;
grant execute on function hr.primary_manager(uuid) to authenticated, service_role;
grant execute on function hr.sync_manager_ids() to service_role;
grant execute on function hr.leads(uuid) to authenticated, service_role;
