-- Leave dates run as the caller. The row filter stays in a definer function so a
-- day-to-day lead still sees dates, and the leave-request note stays behind the
-- table policy. New file only. Do not apply to production.

create or replace function public.hr_leave_date_rows()
returns table (
  id uuid,
  employee_id uuid,
  starts_on date,
  ends_on date,
  kind text,
  status text
)
language sql
stable
security definer
set search_path = hr, public
as $$
  select r.id, r.employee_id, r.starts_on, r.ends_on, r.kind, r.status
  from hr.leave_requests r
  where public.is_active_user()
    and (
      hr.is_self(r.employee_id)
      or hr.leads(r.employee_id)
      or (hr.aal_ok() and hr.can_view_employee(r.employee_id))
    );
$$;

revoke all on function public.hr_leave_date_rows() from public, anon;
grant execute on function public.hr_leave_date_rows() to authenticated, service_role;

create or replace view public.hr_leave_dates
with (security_barrier = true, security_invoker = true) as
select id, employee_id, starts_on, ends_on, kind, status
from public.hr_leave_date_rows();

comment on view public.hr_leave_dates is
  'Leave dates for the person, a day-to-day lead, or someone who can see the HR record. No note. The view runs as the caller. The filter lives in hr_leave_date_rows().';

revoke all on public.hr_leave_dates from public, anon;
grant select on public.hr_leave_dates to authenticated, service_role;

comment on view public.calendar_entries_visible is
  'Stays security definer on purpose. Signed-in users cannot select entry_type or notes on public.calendar_entries. This view reads those columns as its owner, then returns sickness to anyone else only as Off and clears the note. A security-invoker view cannot read the hidden columns, so the calendar would fail closed instead of redacting.';
