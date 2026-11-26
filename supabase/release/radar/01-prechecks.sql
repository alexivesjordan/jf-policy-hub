-- Run before 20261128100000_radar.sql. Read only.
-- Expect every radar relation to be absent, and the notification kind check to have no radar value.

select
  to_regclass('public.radar_settings') is null as settings_absent,
  to_regclass('public.radar_opportunities') is null as opportunities_absent,
  to_regclass('public.radar_hubspot_intents') is null as intents_absent,
  to_regclass('public.radar_reminders') is null as reminders_absent;

select pg_get_constraintdef(oid) not like '%radar%' as kind_check_has_no_radar
from pg_constraint
where conname = 'notifications_kind_check';
