-- Run before 20261128600000_radar_planning_hubspot.sql. Read only.
-- Expect radar_present, type_absent and exclusions_absent all true.

select
  to_regclass('public.radar_opportunities') is not null as radar_present,
  not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'radar_opportunities' and column_name = 'opportunity_type'
  ) as type_absent,
  not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'radar_settings' and column_name = 'exclusions'
  ) as exclusions_absent;
