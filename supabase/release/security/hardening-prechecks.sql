-- Read only. Run before 20261127170000. Do not apply to production.

select
  to_regclass('public.hr_leave_dates') as leave_dates,
  to_regclass('public.calendar_entries_visible') as calendar_view,
  to_regclass('core.companies') as companies,
  to_regclass('core.email_challenges') as challenges,
  to_regprocedure('public.workspace_access_row(uuid, text)') as access_row,
  to_regprocedure('public.guard_last_owner()') as last_owner;
