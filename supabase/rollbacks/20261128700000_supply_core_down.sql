-- Rolls back 20261128700000_supply_core.sql, 20261128700100_supply_rls.sql,
-- 20261128700200_supply_api.sql, and 20261128700300_supply_screens.sql.
-- Drops the new schema, functions, and private import bucket. Does not touch other data.
-- New file only. Do not apply to production.

drop function if exists public.supply_sync_state();
drop function if exists public.supply_sync_state_save(jsonb);
drop function if exists public.supply_sync_products(jsonb);
drop function if exists public.supply_sync_suppliers(jsonb);
drop function if exists public.supply_sync_stock(jsonb);
drop function if exists public.supply_sync_stock_fold(timestamptz);
drop function if exists public.supply_sync_sales(jsonb);
drop function if exists public.supply_sync_purchases(jsonb);
drop function if exists public.supply_forecast_inputs(integer, integer);
drop function if exists public.supply_save_run(jsonb);
drop function if exists public.supply_assert_admin();
drop function if exists public.supply_overview();
drop function if exists public.supply_reorder();
drop function if exists public.supply_set_qty(uuid, numeric);
drop function if exists public.supply_skus(text, integer, integer);
drop function if exists public.supply_sku(text);
drop function if exists public.supply_suppliers();
drop function if exists public.supply_save_supplier(jsonb);
drop function if exists public.supply_save_sku(jsonb);
drop function if exists public.supply_settings();
drop function if exists public.supply_save_settings(jsonb);
drop function if exists public.supply_mappings();
drop function if exists public.supply_save_mapping(jsonb);
drop function if exists public.supply_delete_mapping(uuid);
drop function if exists public.supply_import_begin(jsonb);
drop function if exists public.supply_import_chunk(uuid, jsonb);
drop function if exists public.supply_import_finish(uuid, jsonb);
drop function if exists public.supply_remove_batch(uuid);
drop function if exists public.supply_unmatched(uuid);
drop function if exists public.supply_aliases();
drop function if exists public.supply_save_alias(jsonb);

drop schema if exists supply cascade;

drop policy if exists supply_imports_read on storage.objects;
drop policy if exists supply_imports_insert on storage.objects;
drop policy if exists supply_imports_update on storage.objects;
drop policy if exists supply_imports_delete on storage.objects;

-- storage.protect_delete rejects a direct delete, and this role cannot disable that trigger.
-- Remove the empty supply-imports bucket with the Storage API after this script.
-- The forward migration updates the bucket in place if it is still here.
-- Do not run this on production.

update core.pulses
set status = 'coming-soon'
where id = 'supply';
