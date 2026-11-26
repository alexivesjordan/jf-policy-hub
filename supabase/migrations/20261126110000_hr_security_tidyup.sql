-- HR security tidy-up after Phase 1.
-- Removes the default anon and PUBLIC privileges on the public HR views.
-- Pins search_path on the six HR helpers the advisor flagged.
-- New file only. Do not apply to production.

revoke all on table public.hr_employees from public, anon;
revoke all on table public.hr_leave_requests from public, anon;
revoke all on table public.hr_settings from public, anon;
revoke all on table public.hr_cases from public, anon;
revoke all on table public.hr_change_requests from public, anon;
revoke all on table public.hr_sickness from public, anon;

-- Authenticated and service_role keep the select grant from 20261126100100.
-- These views are security invoker, so the underlying row policies still apply.

alter function hr.mask_row(text, jsonb) set search_path = '';
alter function hr.mask_value(text, text, jsonb) set search_path = '';
alter function hr.prevent_audit_mutation() set search_path = '';
alter function hr.prevent_append_change() set search_path = '';
alter function hr.aal_ok() set search_path = '';
alter function hr.require_mfa() set search_path = '';

comment on view public.calendar_entries_visible is
  'Owner rights on purpose. Signed-in users cannot select entry_type or notes on public.calendar_entries. This view reads those columns as its owner, then returns sickness to anyone else only as Off and clears the note. A security-invoker view could not read the hidden columns, so the redaction would not work.';
