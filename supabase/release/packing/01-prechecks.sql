-- Run before 20261128200000_logistics_packing.sql. Every value here should be null / 0.
select
  to_regclass('logistics.load_spaces') as load_spaces,
  to_regclass('logistics.sku_packages') as sku_packages,
  to_regclass('logistics.packing_settings') as packing_settings,
  to_regclass('logistics.pack_estimates') as pack_estimates,
  to_regprocedure('public.logistics_list_sku_packages(text, boolean, integer, integer)') as list_fn,
  to_regprocedure('public.logistics_seed_sku_packages(jsonb)') as seed_fn,
  to_regprocedure('public.logistics_import_sku_packages(jsonb)') as import_fn;
