-- Landed cost history, stored duty rates, and a tariff cache.
-- Depends on logistics.can_use() from the commercial invoice migrations.

create table logistics.tariff_cache (
  cache_key text primary key,
  body jsonb not null,
  fetched_at timestamptz not null,
  expires_at timestamptz not null
);

create table logistics.duty_rates (
  id uuid primary key default gen_random_uuid(),
  destination_country text not null,
  origin_country text,
  hs_prefix text not null,
  duty_percent numeric(8,4) not null,
  vat_percent numeric(8,4) not null,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  check (destination_country ~ '^[A-Z]{2}$'),
  check (origin_country is null or origin_country ~ '^[A-Z]{2}$'),
  check (hs_prefix ~ '^[0-9]{2,10}$'),
  check (duty_percent >= 0 and duty_percent <= 1000),
  check (vat_percent >= 0 and vat_percent <= 100)
);

create unique index duty_rates_destination_origin_hs
  on logistics.duty_rates (destination_country, coalesce(origin_country, ''), hs_prefix);

create table logistics.landed_cost_calculations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  mode text not null,
  document_kind text,
  document_number text,
  destination_country text not null,
  origin_country text,
  incoterm text not null,
  currency text not null,
  units_per_gbp numeric(16,6) not null,
  rate_source text not null,
  commodity_code text,
  estimate boolean not null,
  stale boolean not null default false,
  input jsonb not null,
  result jsonb not null,
  check (mode in ('calculator', 'shipment')),
  check (document_kind is null or document_kind in ('sale', 'purchase')),
  check (destination_country ~ '^[A-Z]{2}$'),
  check (origin_country is null or origin_country ~ '^[A-Z]{2}$'),
  check (incoterm in ('EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP')),
  check (currency ~ '^[A-Z]{3}$'),
  check (units_per_gbp > 0),
  check (rate_source in ('hmrc', 'manual', 'gbp')),
  check (commodity_code is null or commodity_code ~ '^[0-9]{10}$'),
  check (document_number is null or char_length(document_number) <= 40)
);

create index landed_cost_calculations_created_at
  on logistics.landed_cost_calculations (created_at desc);

create table logistics.landed_cost_lines (
  id uuid primary key default gen_random_uuid(),
  calculation_id uuid not null references logistics.landed_cost_calculations (id) on delete cascade,
  line_no integer not null,
  sku text,
  description text,
  hs_code text,
  origin_country text,
  quantity numeric(14,4),
  goods_value numeric(16,2),
  line_error text,
  result jsonb,
  check (line_no > 0),
  check (hs_code is null or hs_code ~ '^[0-9]{10}$'),
  check (origin_country is null or origin_country ~ '^[A-Z]{2}$'),
  unique (calculation_id, line_no)
);

create index landed_cost_lines_calculation
  on logistics.landed_cost_lines (calculation_id);

alter table logistics.tariff_cache enable row level security;
alter table logistics.duty_rates enable row level security;
alter table logistics.landed_cost_calculations enable row level security;
alter table logistics.landed_cost_lines enable row level security;

revoke all on logistics.tariff_cache from public, anon, authenticated;
grant select on logistics.tariff_cache to authenticated;
grant all on logistics.tariff_cache to service_role;

revoke all on logistics.duty_rates from public, anon;
grant select, insert, update, delete on logistics.duty_rates to authenticated;
grant all on logistics.duty_rates to service_role;

revoke all on logistics.landed_cost_calculations from public, anon;
grant select, insert, delete on logistics.landed_cost_calculations to authenticated;
grant all on logistics.landed_cost_calculations to service_role;

revoke all on logistics.landed_cost_lines from public, anon;
grant select, insert on logistics.landed_cost_lines to authenticated;
grant all on logistics.landed_cost_lines to service_role;

create policy tariff_cache_read
on logistics.tariff_cache
for select
to authenticated
using ((select logistics.can_use()));

create policy duty_rates_logistics
on logistics.duty_rates
for all
to authenticated
using ((select logistics.can_use()))
with check ((select logistics.can_use()));

create policy landed_cost_read
on logistics.landed_cost_calculations
for select
to authenticated
using ((select logistics.can_use()));

create policy landed_cost_insert
on logistics.landed_cost_calculations
for insert
to authenticated
with check ((select logistics.can_use()) and created_by = (select auth.uid()));

create policy landed_cost_delete
on logistics.landed_cost_calculations
for delete
to authenticated
using (
  (select logistics.can_use())
  and (
    created_by = (select auth.uid())
    or (select public.workspace_is_admin())
  )
);

create policy landed_cost_lines_read
on logistics.landed_cost_lines
for select
to authenticated
using ((select logistics.can_use()));

create policy landed_cost_lines_insert
on logistics.landed_cost_lines
for insert
to authenticated
with check (
  (select logistics.can_use())
  and exists (
    select 1
    from logistics.landed_cost_calculations calculation
    where calculation.id = calculation_id
      and calculation.created_by = (select auth.uid())
  )
);
