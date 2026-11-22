-- Customs facts for a SKU, used to pre-fill a commercial invoice.
-- New file only.

create schema if not exists logistics;

create or replace function logistics.can_use()
returns boolean
language sql
stable
security definer
set search_path = logistics, ops, public
as $$
  select auth.uid() is not null
    and not ops.is_field_engineer()
    and (
      public.workspace_is_admin()
      or public.workspace_can('operations', 'view')
    );
$$;

revoke all on function logistics.can_use() from public, anon;
grant execute on function logistics.can_use() to authenticated, service_role;

create table logistics.product_customs (
  sku text primary key,
  hs_code text,
  country_of_origin text,
  material text,
  net_weight_kg numeric(12,3),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  check (hs_code is null or hs_code ~ '^[0-9]{10}$'),
  check (country_of_origin is null or country_of_origin ~ '^[A-Z]{2}$'),
  check (net_weight_kg is null or net_weight_kg >= 0)
);

alter table logistics.product_customs enable row level security;
revoke all on logistics.product_customs from public, anon;
grant select, insert, update on logistics.product_customs to authenticated;
grant all on logistics.product_customs to service_role;
grant usage on schema logistics to authenticated, service_role;

create policy product_customs_logistics
on logistics.product_customs
for all
to authenticated
using (logistics.can_use())
with check (logistics.can_use());

create or replace function public.logistics_product_customs(p_skus text[])
returns jsonb
language sql
stable
security definer
set search_path = logistics, public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'sku', sku,
    'hsCode', hs_code,
    'origin', country_of_origin,
    'material', material,
    'netWeightKg', net_weight_kg
  )), '[]'::jsonb)
  from logistics.product_customs
  where logistics.can_use()
    and sku = any (p_skus);
$$;

revoke all on function public.logistics_product_customs(text[]) from public, anon;
grant execute on function public.logistics_product_customs(text[]) to authenticated, service_role;
