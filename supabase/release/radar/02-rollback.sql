-- Copy of the tested rollback. See supabase/rollbacks/20261128100000_radar_down.sql.
-- Destructive: deletes radar notifications and drops the radar tables.

delete from public.notifications where kind = 'radar';

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications
  add constraint notifications_kind_check
  check (kind in ('proposal', 'auto_applied', 'decision', 'hr'));

drop table if exists public.radar_reminders;
drop table if exists public.radar_hubspot_intents;
drop table if exists public.radar_opportunities;
drop table if exists public.radar_settings;

drop function if exists public.radar_owner_choices();
drop function if exists public.radar_guard_opportunity();
drop function if exists public.radar_guard_settings();
drop function if exists public.radar_bands_ok(jsonb);
drop function if exists public.radar_cpv_ok(text[]);
drop function if exists public.radar_keywords_ok(text[]);
