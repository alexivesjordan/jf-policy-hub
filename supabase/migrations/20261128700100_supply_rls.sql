-- Pulse Supply access. View can read. Edit can write. Admin deletes settings and mappings.
-- Owners and workspace admins always can. No anon access.
-- New file only. Do not apply to production.

create or replace function supply.is_workspace_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.is_active
      and p.access_granted
      and (p.workspace_role in ('owner', 'admin') or p.role = 'admin')
  );
$$;

create or replace function supply.can_read()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
    and (supply.is_workspace_admin() or public.workspace_can('supply', 'view'));
$$;

create or replace function supply.can_write()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
    and (supply.is_workspace_admin() or public.workspace_can('supply', 'edit'));
$$;

create or replace function supply.can_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
    and (
      supply.is_workspace_admin()
      or public.workspace_level(auth.uid(), 'supply') = 'admin'
    );
$$;

revoke all on function supply.is_workspace_admin() from public, anon;
revoke all on function supply.can_read() from public, anon;
revoke all on function supply.can_write() from public, anon;
revoke all on function supply.can_admin() from public, anon;
grant execute on function supply.is_workspace_admin() to authenticated, service_role;
grant execute on function supply.can_read() to authenticated, service_role;
grant execute on function supply.can_write() to authenticated, service_role;
grant execute on function supply.can_admin() to authenticated, service_role;

do $$
declare
  t text;
begin
  foreach t in array array[
    'settings', 'suppliers', 'sku_settings', 'stock_snapshots', 'stock_location_stage',
    'demand_monthly', 'cin7_sale_lines', 'po_history', 'sku_aliases',
    'import_mappings', 'import_batches', 'import_unmatched',
    'forecast_runs', 'forecasts', 'reorder_suggestions'
  ]
  loop
    execute format('alter table supply.%I enable row level security', t);
    execute format('alter table supply.%I force row level security', t);
    execute format('drop policy if exists %I on supply.%I', t || '_read', t);
    execute format('drop policy if exists %I on supply.%I', t || '_insert', t);
    execute format('drop policy if exists %I on supply.%I', t || '_update', t);
    execute format('drop policy if exists %I on supply.%I', t || '_delete', t);
    execute format(
      'create policy %I on supply.%I for select to authenticated using (supply.can_read())',
      t || '_read', t
    );
    execute format(
      'create policy %I on supply.%I for insert to authenticated with check (supply.can_write())',
      t || '_insert', t
    );
    execute format(
      'create policy %I on supply.%I for update to authenticated using (supply.can_write()) with check (supply.can_write())',
      t || '_update', t
    );
    if t in ('settings', 'import_mappings') then
      execute format(
        'create policy %I on supply.%I for delete to authenticated using (supply.can_admin())',
        t || '_delete', t
      );
    else
      execute format(
        'create policy %I on supply.%I for delete to authenticated using (supply.can_write())',
        t || '_delete', t
      );
    end if;
  end loop;
end
$$;

drop policy if exists supply_imports_read on storage.objects;
drop policy if exists supply_imports_insert on storage.objects;
drop policy if exists supply_imports_update on storage.objects;
drop policy if exists supply_imports_delete on storage.objects;

create policy supply_imports_read
on storage.objects
for select
to authenticated
using (bucket_id = 'supply-imports' and supply.can_read());

create policy supply_imports_insert
on storage.objects
for insert
to authenticated
with check (bucket_id = 'supply-imports' and supply.can_write());

create policy supply_imports_update
on storage.objects
for update
to authenticated
using (bucket_id = 'supply-imports' and supply.can_write())
with check (bucket_id = 'supply-imports' and supply.can_write());

create policy supply_imports_delete
on storage.objects
for delete
to authenticated
using (bucket_id = 'supply-imports' and supply.can_admin());
