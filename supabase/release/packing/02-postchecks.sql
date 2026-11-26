-- Run after 20261128200000_logistics_packing.sql.
select
  c.relname,
  c.relrowsecurity as rls,
  c.relforcerowsecurity as forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'logistics'
  and c.relname in ('load_spaces', 'sku_packages', 'packing_settings', 'pack_estimates')
order by c.relname;

select
  p.proname,
  p.prosecdef as security_definer
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('logistics_list_sku_packages', 'logistics_seed_sku_packages', 'logistics_import_sku_packages')
order by p.proname;

select
  has_table_privilege('anon', 'logistics.sku_packages', 'select') as anon_packages,
  has_table_privilege('anon', 'logistics.load_spaces', 'select') as anon_spaces,
  has_table_privilege('anon', 'logistics.pack_estimates', 'select') as anon_estimates,
  has_table_privilege('authenticated', 'logistics.sku_packages', 'select') as auth_packages,
  has_table_privilege('authenticated', 'logistics.load_spaces', 'insert') as auth_insert_spaces,
  has_table_privilege('authenticated', 'logistics.pack_estimates', 'delete') as auth_delete_estimates,
  (select count(*) from logistics.load_spaces) as spaces,
  (select count(*) from logistics.load_spaces where kind = 'pallet') as pallets,
  (select pallet_code from logistics.packing_settings where id = 'default') as default_pallet;

select count(*) as logistics_views
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'logistics' and c.relkind = 'v';
