-- HR Pulse policies and the functions the screens call.
-- New file only. Do not apply to production.

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications
  add constraint notifications_kind_check
  check (kind in ('proposal', 'auto_applied', 'decision', 'hr'));

grant select on
  hr.settings, hr.directors, hr.employees, hr.employment_terms, hr.salaries,
  hr.right_to_work, hr.emergency_contacts, hr.change_requests, hr.leave_allowances,
  hr.bank_holidays, hr.leave_requests, hr.sickness, hr.cases, hr.case_members,
  hr.case_entries, hr.files, hr.audit_log, hr.external_partners
to authenticated;

create policy settings_read on hr.settings for select to authenticated
using (public.is_active_user());

create policy directors_read on hr.directors for select to authenticated
using (public.is_active_user());

create policy employees_read on hr.employees for select to authenticated
using (hr.is_self(id) or (hr.aal_ok() and hr.can_view_employee(id)));

create policy terms_read on hr.employment_terms for select to authenticated
using (hr.is_self(employee_id) or (hr.aal_ok() and hr.can_view_employee(employee_id)));

create policy contacts_read on hr.emergency_contacts for select to authenticated
using (hr.is_self(employee_id) or (hr.aal_ok() and hr.can_view_employee(employee_id)));

create policy rtw_read on hr.right_to_work for select to authenticated
using (hr.is_self(employee_id) or (hr.aal_ok() and hr.can_view_employee(employee_id)));

create policy salary_read on hr.salaries for select to authenticated
using (hr.is_self(employee_id) or (hr.aal_ok() and hr.can_view_salary(employee_id)));

create policy changes_read on hr.change_requests for select to authenticated
using (hr.is_self(employee_id) or (hr.aal_ok() and hr.can_view_employee(employee_id)));

create policy allowance_read on hr.leave_allowances for select to authenticated
using (hr.is_self(employee_id) or (hr.aal_ok() and hr.can_view_employee(employee_id)));

create policy leave_read on hr.leave_requests for select to authenticated
using (hr.is_self(employee_id) or (hr.aal_ok() and hr.can_view_employee(employee_id)));

create policy sickness_read on hr.sickness for select to authenticated
using (hr.is_self(employee_id) or (hr.aal_ok() and hr.can_view_employee(employee_id)));

create policy holidays_read on hr.bank_holidays for select to authenticated
using (public.is_active_user());

create policy cases_read on hr.cases for select to authenticated
using (hr.aal_ok() and hr.is_case_member(id));

create policy case_entries_read on hr.case_entries for select to authenticated
using (hr.aal_ok() and hr.is_case_member(case_id));

create policy case_members_read on hr.case_members for select to authenticated
using (hr.aal_ok() and hr.is_case_member(case_id));

create policy files_read on hr.files for select to authenticated
using (
  (case_id is null and employee_id is not null and hr.is_self(employee_id))
  or (
    hr.aal_ok() and (
      (case_id is not null and hr.is_case_member(case_id))
      or (case_id is null and employee_id is not null and hr.can_view_employee(employee_id) and not hr.is_self(employee_id))
    )
  )
);

create policy audit_read on hr.audit_log for select to authenticated
using (hr.aal_ok() and hr.is_director());

create policy partners_read on hr.external_partners for select to authenticated
using (hr.aal_ok() and hr.is_director());

create or replace function hr.notify(p_user uuid, p_title text, p_link text)
returns void
language plpgsql
security definer
set search_path = hr, public
as $$
begin
  if p_user is null then return; end if;
  if p_title not in (
    'Something needs your attention in HR Pulse',
    'A request needs your decision',
    'Your request has been decided'
  ) then
    raise exception 'app: That notice is not allowed.';
  end if;
  insert into public.notifications (user_id, title, body, kind, link)
  values (p_user, p_title, 'Open HR Pulse to see it.', 'hr', p_link);
end;
$$;

create or replace function hr.log_event(p_table text, p_id uuid, p_action text)
returns void
language plpgsql
security definer
set search_path = hr, public
as $$
begin
  insert into hr.audit_log (actor_id, module_id, entity_schema, entity_table, entity_id, action)
  values (auth.uid(), 'people', 'hr', p_table, p_id, p_action);
end;
$$;

create or replace function public.hr_log_view(p_table text, p_id uuid)
returns void
language plpgsql
security definer
set search_path = hr, public
as $$
begin
  if not public.is_active_user() then
    raise exception 'app: You cannot open that.';
  end if;
  perform hr.log_event(p_table, p_id, case when p_id is null then 'list_view' else 'view' end);
end;
$$;

create or replace function public.hr_submit_change(p_field text, p_value jsonb)
returns uuid
language plpgsql
security definer
set search_path = hr, public
as $$
declare
  v_employee uuid := hr.current_employee_id();
  v_id uuid;
  v_old jsonb;
  v_manager uuid;
begin
  if v_employee is null then raise exception 'app: No HR record yet.'; end if;
  if p_field not in ('phone', 'personal_email', 'home_address', 'emergency_contacts', 'preferred_name') then
    raise exception 'app: That detail cannot be requested here.';
  end if;
  select to_jsonb(e) -> p_field into v_old from hr.employees e where e.id = v_employee;
  insert into hr.change_requests (employee_id, field_key, old_value, new_value, submitted_by)
  values (v_employee, p_field, v_old, p_value, auth.uid())
  returning id into v_id;
  select manager.profile_id into v_manager
  from hr.employees self
  join hr.employees manager on manager.id = self.manager_id
  where self.id = v_employee;
  perform hr.notify(v_manager, 'A request needs your decision', '/people/team/' || v_employee);
  return v_id;
end;
$$;

create or replace function public.hr_decide_change(p_id uuid, p_approve boolean, p_note text)
returns void
language plpgsql
security definer
set search_path = hr, public
as $$
declare
  v_row hr.change_requests;
begin
  perform hr.require_mfa();
  select * into v_row from hr.change_requests where id = p_id;
  if v_row.id is null then raise exception 'app: That request is not here.'; end if;
  if v_row.submitted_by = auth.uid() then raise exception 'app: You cannot decide your own request.'; end if;
  if not (hr.manages(v_row.employee_id) or hr.is_director()) then
    raise exception 'app: You cannot decide that request.';
  end if;
  if v_row.status <> 'pending' then raise exception 'app: That request is already decided.'; end if;
  update hr.change_requests
  set status = case when p_approve then 'approved' else 'rejected' end,
      decided_by = auth.uid(),
      decided_at = now(),
      note = nullif(trim(coalesce(p_note, '')), '')
  where id = p_id;
  if p_approve then
    if v_row.field_key = 'phone' then
      update hr.employees set phone = v_row.new_value #>> '{}' where id = v_row.employee_id;
    elsif v_row.field_key = 'personal_email' then
      update hr.employees set personal_email = v_row.new_value #>> '{}' where id = v_row.employee_id;
    elsif v_row.field_key = 'preferred_name' then
      update hr.employees set preferred_name = v_row.new_value #>> '{}' where id = v_row.employee_id;
    elsif v_row.field_key = 'home_address' then
      update hr.employees set home_address = v_row.new_value where id = v_row.employee_id;
    elsif v_row.field_key = 'emergency_contacts' then
      delete from hr.emergency_contacts where employee_id = v_row.employee_id;
      insert into hr.emergency_contacts (employee_id, name, relationship, phone_primary, phone_secondary)
      select v_row.employee_id, item->>'name', item->>'relationship', item->>'phone_primary', item->>'phone_secondary'
      from jsonb_array_elements(coalesce(v_row.new_value, '[]'::jsonb)) item;
    end if;
  end if;
  perform hr.notify(v_row.submitted_by, 'Your request has been decided', '/people/me');
end;
$$;

create or replace function public.hr_request_leave(
  p_start date, p_end date, p_start_half boolean, p_end_half boolean, p_kind text, p_note text
)
returns uuid
language plpgsql
security definer
set search_path = hr, public
as $$
declare
  v_employee uuid := hr.current_employee_id();
  v_region text;
  v_days numeric;
  v_id uuid;
  v_manager uuid;
begin
  if v_employee is null then raise exception 'app: No HR record yet.'; end if;
  if p_kind not in ('annual', 'unpaid', 'other') then raise exception 'app: Choose a type of leave.'; end if;
  if p_end < p_start then raise exception 'app: Check the dates.'; end if;
  select bank_holiday_region into v_region from hr.settings limit 1;
  v_days := hr.working_days(p_start, p_end, coalesce(p_start_half, false), coalesce(p_end_half, false), v_region);
  insert into hr.leave_requests (employee_id, starts_on, ends_on, start_half, end_half, days, kind, note)
  values (v_employee, p_start, p_end, coalesce(p_start_half, false), coalesce(p_end_half, false), v_days, p_kind, nullif(trim(coalesce(p_note, '')), ''))
  returning id into v_id;
  select manager.profile_id into v_manager
  from hr.employees self
  join hr.employees manager on manager.id = self.manager_id
  where self.id = v_employee;
  perform hr.notify(v_manager, 'A request needs your decision', '/people/time-off');
  return v_id;
end;
$$;

create or replace function public.hr_decide_leave(p_id uuid, p_approve boolean, p_note text)
returns void
language plpgsql
security definer
set search_path = hr, public
as $$
declare
  v_row hr.leave_requests;
  v_who uuid;
begin
  perform hr.require_mfa();
  select * into v_row from hr.leave_requests where id = p_id;
  if v_row.id is null then raise exception 'app: That request is not here.'; end if;
  select profile_id into v_who from hr.employees where id = v_row.employee_id;
  if v_who = auth.uid() then raise exception 'app: You cannot decide your own request.'; end if;
  if not (hr.manages(v_row.employee_id) or hr.is_director()) then
    raise exception 'app: You cannot decide that request.';
  end if;
  update hr.leave_requests
  set status = case when p_approve then 'approved' else 'declined' end,
      approver_id = auth.uid(),
      decided_at = now(),
      note = coalesce(nullif(trim(coalesce(p_note, '')), ''), note)
  where id = p_id;
  perform hr.notify(v_who, 'Your request has been decided', '/people/time-off');
end;
$$;

create or replace function public.hr_report_sickness(p_employee uuid, p_start date, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = hr, public
as $$
declare
  v_id uuid;
  v_self boolean := hr.is_self(p_employee);
begin
  if not v_self then
    perform hr.require_mfa();
    if not (hr.manages(p_employee) or hr.is_director()) then
      raise exception 'app: You cannot report that absence.';
    end if;
  end if;
  insert into hr.sickness (employee_id, starts_on, reason_category, status)
  values (p_employee, p_start, nullif(trim(coalesce(p_reason, '')), ''), 'open')
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.hr_open_case(p_type text, p_subject uuid, p_title text, p_route text)
returns uuid
language plpgsql
security definer
set search_path = hr, public
as $$
declare
  v_id uuid;
  v_stage text;
  v_due date;
  v_restricted boolean;
  v_profile uuid;
begin
  perform hr.require_mfa();
  if not public.is_active_user() then raise exception 'app: You cannot open a case.'; end if;
  if p_type not in ('disciplinary', 'grievance', 'performance', 'health', 'flexible_working') then
    raise exception 'app: Choose a case type.';
  end if;
  if p_route not in ('manager', 'director_only') then raise exception 'app: Choose a route.'; end if;
  if nullif(trim(p_title), '') is null then raise exception 'app: Add a title.'; end if;
  v_restricted := p_route = 'director_only' or exists (select 1 from hr.employees e where e.manager_id = p_subject);
  v_stage := case when p_type = 'flexible_working' then 'requested' else 'raised' end;
  v_due := case when p_type = 'flexible_working' then (current_date + interval '2 months')::date else null end;
  insert into hr.cases (case_type, subject_employee_id, title, route, stage, decision_due_on, opened_by, retention_until)
  values (p_type, p_subject, trim(p_title), p_route, v_stage, v_due, auth.uid(), current_date + interval '6 years')
  returning id into v_id;
  if v_restricted then
    insert into hr.case_members (case_id, profile_id, member_role, added_by)
    select v_id, d.profile_id, 'member', auth.uid()
    from hr.directors d
    where not exists (select 1 from hr.chain_profile_ids(p_subject) blocked where blocked = d.profile_id)
      and not exists (
        select 1 from hr.employees subject
        join hr.employees manager on manager.id = subject.manager_id
        where subject.id = p_subject and manager.profile_id = d.profile_id
      )
    on conflict do nothing;
    if auth.uid() is not null
       and not exists (select 1 from hr.chain_profile_ids(p_subject) blocked where blocked = auth.uid())
       and not exists (
         select 1 from hr.employees subject
         join hr.employees manager on manager.id = subject.manager_id
         where subject.id = p_subject and manager.profile_id = auth.uid()
       )
    then
      insert into hr.case_members (case_id, profile_id, member_role, added_by)
      values (v_id, auth.uid(), 'owner', auth.uid())
      on conflict (case_id, profile_id) do nothing;
    end if;
  else
    insert into hr.case_members (case_id, profile_id, member_role, added_by)
    values (v_id, auth.uid(), 'owner', auth.uid());
  end if;
  insert into hr.case_entries (case_id, kind, author_id, body)
  values (v_id, 'stage_change', auth.uid(), v_stage);
  for v_profile in select profile_id from hr.case_members where case_id = v_id and profile_id is distinct from auth.uid()
  loop
    perform hr.notify(v_profile, 'Something needs your attention in HR Pulse', '/people/cases/' || v_id);
  end loop;
  return v_id;
end;
$$;

create or replace function public.hr_add_case_member(p_case uuid, p_profile uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = hr, public
as $$
declare
  v_case hr.cases;
  v_owner boolean;
begin
  perform hr.require_mfa();
  select * into v_case from hr.cases where id = p_case;
  if v_case.id is null or not hr.is_case_member(p_case) then
    raise exception 'app: You cannot see that case.';
  end if;
  v_owner := exists (
    select 1 from hr.case_members m
    where m.case_id = p_case and m.profile_id = auth.uid() and m.member_role = 'owner'
  );
  if not (v_owner or (v_case.route = 'director_only' and hr.is_director())) then
    raise exception 'app: You cannot add someone to that case.';
  end if;
  if v_case.route = 'director_only' or exists (select 1 from hr.employees e where e.manager_id = v_case.subject_employee_id) then
    if p_profile in (select hr.chain_profile_ids(v_case.subject_employee_id))
       or exists (
         select 1 from hr.employees subject
         join hr.employees manager on manager.id = subject.manager_id
         where subject.id = v_case.subject_employee_id and manager.profile_id = p_profile
       )
    then
      raise exception 'app: That person cannot be added to this case.';
    end if;
  end if;
  if p_role not in ('owner', 'member', 'hr_partner') then raise exception 'app: Choose a role.'; end if;
  insert into hr.case_members (case_id, profile_id, member_role, added_by)
  values (p_case, p_profile, p_role, auth.uid())
  on conflict do nothing;
  perform hr.notify(p_profile, 'Something needs your attention in HR Pulse', '/people/cases/' || p_case);
end;
$$;

create or replace function public.hr_add_case_entry(p_case uuid, p_kind text, p_body text)
returns uuid
language plpgsql
security definer
set search_path = hr, public
as $$
declare
  v_id uuid;
begin
  perform hr.require_mfa();
  if not hr.is_case_member(p_case) then raise exception 'app: You cannot see that case.'; end if;
  if p_kind not in ('note', 'letter', 'meeting') then raise exception 'app: Choose what to add.'; end if;
  insert into hr.case_entries (case_id, kind, author_id, body)
  values (p_case, p_kind, auth.uid(), nullif(trim(p_body), ''))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.hr_advance_case(p_case uuid, p_stage text)
returns void
language plpgsql
security definer
set search_path = hr, public
as $$
begin
  perform hr.require_mfa();
  if not hr.is_case_member(p_case) then raise exception 'app: You cannot see that case.'; end if;
  if p_stage not in (
    'raised', 'investigation', 'meeting_invited', 'meeting_held', 'outcome_sent', 'appeal', 'closed',
    'requested', 'meeting', 'decided'
  ) then
    raise exception 'app: That stage is not available.';
  end if;
  update hr.cases
  set stage = p_stage,
      closed_at = case when p_stage = 'closed' then now() else closed_at end
  where id = p_case;
  insert into hr.case_entries (case_id, kind, author_id, body)
  values (
    p_case,
    'stage_change',
    auth.uid(),
    case
      when p_stage = 'meeting_invited' then 'Meeting invited. The person can be accompanied. Give reasonable notice.'
      else p_stage
    end
  );
end;
$$;

create or replace function public.hr_team_calendar(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = hr, public
as $$
begin
  if not public.is_active_user() then raise exception 'app: You cannot see the calendar.'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', id, 'name', name, 'startsOn', starts_on, 'endsOn', ends_on, 'label', 'Away'
    ) order by starts_on, name)
    from (
      select r.id, coalesce(e.preferred_name, e.full_name) as name, r.starts_on, r.ends_on
      from hr.leave_requests r
      join hr.employees e on e.id = r.employee_id
      where r.status = 'approved' and r.ends_on >= p_from and r.starts_on <= p_to
      union all
      select s.id, coalesce(e.preferred_name, e.full_name), s.starts_on, coalesce(s.ends_on, current_date)
      from hr.sickness s
      join hr.employees e on e.id = s.employee_id
      where s.status in ('open', 'returned')
        and coalesce(s.ends_on, current_date) >= p_from
        and s.starts_on <= p_to
    ) away
  ), '[]'::jsonb);
end;
$$;

create or replace function public.hr_replace_bank_holidays(p_region text, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = hr, public
as $$
declare
  v_count integer;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'app: You cannot load bank holidays.';
  end if;
  insert into hr.bank_holidays (region, holiday_on, title)
  select p_region, (item->>'date')::date, item->>'title'
  from jsonb_array_elements(p_rows) item
  on conflict (region, holiday_on) do update set title = excluded.title;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.hr_record_case_email(p_hash text, p_from text, p_subject text, p_body text)
returns uuid
language plpgsql
security definer
set search_path = hr, public
as $$
declare
  v_case uuid;
  v_id uuid;
  v_enabled boolean;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'app: You cannot add that email.';
  end if;
  select inbound_email_enabled into v_enabled from hr.settings limit 1;
  if not coalesce(v_enabled, false) then return null; end if;
  select id into v_case from hr.cases where inbound_token_hash = p_hash;
  if v_case is null then return null; end if;
  insert into hr.case_entries (case_id, kind, occurred_at, body, email_from, email_subject)
  values (v_case, 'email', now(), p_body, p_from, p_subject)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.hr_home()
returns jsonb
language plpgsql
stable
security definer
set search_path = hr, public
as $$
declare
  v_employee uuid := hr.current_employee_id();
  v_entitlement numeric := 20;
  v_taken numeric := 0;
  v_booked numeric := 0;
begin
  if not public.is_active_user() then raise exception 'app: You cannot open HR Pulse.'; end if;
  perform hr.log_event('employees', null, 'list_view');
  if v_employee is not null then
    select coalesce(sum(days) filter (where status = 'approved'), 0), coalesce(sum(days) filter (where status = 'requested'), 0)
      into v_taken, v_booked
    from hr.leave_requests where employee_id = v_employee;
  end if;
  return jsonb_build_object(
    'allowance', jsonb_build_object('entitlement', v_entitlement, 'taken', v_taken, 'booked', v_booked, 'left', greatest(v_entitlement - v_taken - v_booked, 0)),
    'manager', exists (select 1 from hr.employees e join hr.employees me on me.id = e.manager_id where me.profile_id = auth.uid()),
    'director', hr.is_director(),
    'mfaRequired', not hr.aal_ok() and exists (select 1 from hr.employees e join hr.employees me on me.id = e.manager_id where me.profile_id = auth.uid())
  );
end;
$$;

revoke all on function public.hr_home() from public, anon;
revoke all on function public.hr_log_view(text, uuid) from public, anon;
revoke all on function public.hr_submit_change(text, jsonb) from public, anon;
revoke all on function public.hr_decide_change(uuid, boolean, text) from public, anon;
revoke all on function public.hr_request_leave(date, date, boolean, boolean, text, text) from public, anon;
revoke all on function public.hr_decide_leave(uuid, boolean, text) from public, anon;
revoke all on function public.hr_report_sickness(uuid, date, text) from public, anon;
revoke all on function public.hr_open_case(text, uuid, text, text) from public, anon;
revoke all on function public.hr_add_case_member(uuid, uuid, text) from public, anon;
revoke all on function public.hr_add_case_entry(uuid, text, text) from public, anon;
revoke all on function public.hr_advance_case(uuid, text) from public, anon;
revoke all on function public.hr_team_calendar(date, date) from public, anon;
revoke all on function public.hr_replace_bank_holidays(text, jsonb) from public, anon;
revoke all on function public.hr_record_case_email(text, text, text, text) from public, anon;

grant execute on function public.hr_home() to authenticated, service_role;
grant execute on function public.hr_log_view(text, uuid) to authenticated, service_role;
grant execute on function public.hr_submit_change(text, jsonb) to authenticated, service_role;
grant execute on function public.hr_decide_change(uuid, boolean, text) to authenticated, service_role;
grant execute on function public.hr_request_leave(date, date, boolean, boolean, text, text) to authenticated, service_role;
grant execute on function public.hr_decide_leave(uuid, boolean, text) to authenticated, service_role;
grant execute on function public.hr_report_sickness(uuid, date, text) to authenticated, service_role;
grant execute on function public.hr_open_case(text, uuid, text, text) to authenticated, service_role;
grant execute on function public.hr_add_case_member(uuid, uuid, text) to authenticated, service_role;
grant execute on function public.hr_add_case_entry(uuid, text, text) to authenticated, service_role;
grant execute on function public.hr_advance_case(uuid, text) to authenticated, service_role;
grant execute on function public.hr_team_calendar(date, date) to authenticated, service_role;
grant execute on function public.hr_replace_bank_holidays(text, jsonb) to service_role;
grant execute on function public.hr_record_case_email(text, text, text, text) to service_role;

-- Public read views so the app does not need the hr schema on the Data API.
-- security_invoker keeps the caller's row policies.
create or replace view public.hr_employees with (security_barrier = true, security_invoker = true) as select * from hr.employees;
create or replace view public.hr_leave_requests with (security_barrier = true, security_invoker = true) as select * from hr.leave_requests;
create or replace view public.hr_settings with (security_barrier = true, security_invoker = true) as select * from hr.settings;
create or replace view public.hr_cases with (security_barrier = true, security_invoker = true) as select * from hr.cases;
grant select on public.hr_employees, public.hr_leave_requests, public.hr_settings, public.hr_cases to authenticated, service_role;
