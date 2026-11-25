-- Rolls back the company calendar privacy view.
-- Run this before the HR Phase 1 rollback. The helper reads hr.employees.
-- DESTRUCTIVE to the view only. The calendar rows stay.

drop view if exists public.calendar_entries_visible;
drop function if exists public.calendar_can_see_detail(uuid);

grant select on table public.calendar_entries to authenticated;
