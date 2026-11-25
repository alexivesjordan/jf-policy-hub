-- Rolls back HR Pulse Phase 1 on TEST. Drops the hr schema and the private bucket.
-- DESTRUCTIVE. Do not run on production.

drop view if exists public.hr_employees;
drop view if exists public.hr_leave_requests;
drop view if exists public.hr_settings;
drop view if exists public.hr_cases;

drop schema if exists hr cascade;

-- storage.protect_delete rejects direct deletes from storage.objects and storage.buckets.
-- Remove the hr-private bucket with the Storage API after this script. Do not run this on production.

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications
  add constraint notifications_kind_check
  check (kind in ('proposal', 'auto_applied', 'decision'));
