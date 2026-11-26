-- Rolls back 20261126110000_hr_security_tidyup.sql.
-- Restores the anon grants that Supabase added by default, and clears the pinned search_path.
-- Not destructive to rows. Do not run on production.

grant all on table public.hr_employees to anon;
grant all on table public.hr_leave_requests to anon;
grant all on table public.hr_settings to anon;
grant all on table public.hr_cases to anon;
grant all on table public.hr_change_requests to anon;
grant all on table public.hr_sickness to anon;

alter function hr.mask_row(text, jsonb) reset search_path;
alter function hr.mask_value(text, text, jsonb) reset search_path;
alter function hr.prevent_audit_mutation() reset search_path;
alter function hr.prevent_append_change() reset search_path;
alter function hr.aal_ok() reset search_path;
alter function hr.require_mfa() reset search_path;

comment on view public.calendar_entries_visible is
  'Company calendar for the browser. Sick type and notes are removed unless the viewer is the person, their line manager, or a director or admin.';
