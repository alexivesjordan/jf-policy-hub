-- DESTRUCTIVE. Drops packaging dimensions, saved pack estimates, packing defaults,
-- and the pallet / container / vehicle catalogue.
-- Does not touch commercial invoices, product customs, or Cin7.
-- Apply only when those four tables are allowed to go.
-- When the migration was applied from this file, it also removes version 20261128200000.

drop function if exists public.logistics_list_sku_packages(text, boolean, integer, integer);
drop function if exists public.logistics_seed_sku_packages(jsonb);
drop function if exists public.logistics_import_sku_packages(jsonb);

drop table if exists logistics.pack_estimates;
drop table if exists logistics.packing_settings;
drop table if exists logistics.sku_packages;
drop table if exists logistics.load_spaces;

delete from supabase_migrations.schema_migrations
where version = '20261128200000';
