-- DESTRUCTIVE. Drops landed-cost history, stored duty rates and the tariff cache.
-- Refuses while any calculation or stored rate exists unless
-- logistics.allow_landed_cost_rollback is yes.
-- Does not drop the logistics schema or commercial invoices.

do $$
declare
  v_rows bigint;
begin
  select count(*) into v_rows from logistics.landed_cost_calculations;
  if v_rows > 0 and coalesce(current_setting('logistics.allow_landed_cost_rollback', true), '') <> 'yes' then
    raise exception 'Refusing to roll back: landed cost calculations exist. Set logistics.allow_landed_cost_rollback to yes to delete them.';
  end if;
  select count(*) into v_rows from logistics.duty_rates;
  if v_rows > 0 and coalesce(current_setting('logistics.allow_landed_cost_rollback', true), '') <> 'yes' then
    raise exception 'Refusing to roll back: stored duty rates exist. Set logistics.allow_landed_cost_rollback to yes to delete them.';
  end if;
end $$;

drop table if exists logistics.landed_cost_lines;
drop table if exists logistics.landed_cost_calculations;
drop table if exists logistics.duty_rates;
drop table if exists logistics.tariff_cache;

delete from supabase_migrations.schema_migrations
where version = '20261128300000';
