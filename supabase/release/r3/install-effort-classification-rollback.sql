-- Rollback for 20261124160000_install_effort_classification.sql.
-- Restores every backed-up ops.sku_effort row that is still 'suggested' (rows confirmed since are left alone),
-- restores ops.cin7_category_defaults exactly, puts back the previous apply_suggested_profiles(),
-- then drops the new columns and the backup tables.

begin;

create or replace function ops.apply_suggested_profiles()
returns void
language plpgsql
as $$
begin
  update ops.sku_effort e
  set needs_assembly = d.needs_assembly,
      crew = d.crew,
      build_minutes = d.build_minutes,
      effort_unit = d.effort_unit,
      build_location = d.build_location,
      hq_build_minutes = d.hq_build_minutes,
      hq_build_crew = d.hq_build_crew,
      site_position_minutes = d.site_position_minutes,
      suggestion_rule = null,
      updated_at = now()
  from ops.cin7_category_defaults d
  where e.status = 'suggested'
    and e.cin7_category = d.category
    and not ops.pin_loaded_suggestion(e.sku, e.product_name)
    and not ops.sled_track_suggestion(e.product_name, e.sku);

  update ops.sku_effort e
  set needs_assembly = s.needs_assembly,
      crew = s.crew,
      build_minutes = s.build_minutes,
      effort_unit = s.effort_unit,
      build_location = s.build_location,
      hq_build_minutes = s.hq_build_minutes,
      hq_build_crew = s.hq_build_crew,
      site_position_minutes = s.site_position_minutes,
      suggestion_rule = 'pin-loaded',
      updated_at = now()
  from ops.cin7_category_defaults s
  where s.category = 'Strength Machines'
    and e.status = 'suggested'
    and ops.pin_loaded_suggestion(e.sku, e.product_name)
    and not ops.sled_track_suggestion(e.product_name, e.sku);

  update ops.sku_effort e
  set needs_assembly = true,
      crew = 2,
      build_minutes = 180,
      effort_unit = 'm2',
      build_location = 'site',
      hq_build_minutes = null,
      hq_build_crew = null,
      site_position_minutes = null,
      suggestion_rule = 'sled-track',
      updated_at = now()
  where e.status = 'suggested'
    and ops.sled_track_suggestion(e.product_name, e.sku);
end;
$$;


update ops.sku_effort e
set needs_assembly = b.needs_assembly,
    crew = b.crew,
    build_minutes = b.build_minutes,
    build_location = b.build_location,
    hq_build_minutes = b.hq_build_minutes,
    hq_build_crew = b.hq_build_crew,
    site_position_minutes = b.site_position_minutes,
    suggestion_rule = b.suggestion_rule,
    effort_unit = b.effort_unit,
    updated_by = b.updated_by,
    updated_at = b.updated_at
from ops.sku_effort_backup_20261124 b
where e.sku = b.sku and e.status = 'suggested';

delete from ops.cin7_category_defaults d
where not exists (select 1 from ops.cin7_category_defaults_backup_20261124 b where b.category = d.category);

update ops.cin7_category_defaults d
set needs_assembly = b.needs_assembly,
    crew = b.crew,
    build_minutes = b.build_minutes,
    status = b.status,
    notes = b.notes,
    updated_by = b.updated_by,
    updated_at = b.updated_at,
    build_location = b.build_location,
    hq_build_minutes = b.hq_build_minutes,
    hq_build_crew = b.hq_build_crew,
    site_position_minutes = b.site_position_minutes,
    effort_unit = b.effort_unit
from ops.cin7_category_defaults_backup_20261124 b
where d.category = b.category;

alter table ops.sku_effort
  drop column if exists effort_class,
  drop column if exists effort_rule,
  drop column if exists rack_family;

drop table ops.sku_effort_backup_20261124;
drop table ops.cin7_category_defaults_backup_20261124;

commit;
