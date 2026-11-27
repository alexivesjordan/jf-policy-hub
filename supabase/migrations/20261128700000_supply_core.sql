-- Pulse Supply. Procurement settings, Cin7 snapshots, forecasts, and Orderwise import batches.
-- Cin7 sale lines and per-location stock are staged so an incremental sync can resume
-- and still keep one demand row and one daily stock row per SKU.
-- Orderwise demand is unique per batch so removing a batch restores the earlier file.
-- New file only. Do not apply to production.

create schema if not exists supply;

revoke all on schema supply from public, anon;
grant usage on schema supply to authenticated, service_role;

comment on schema supply is
  'Pulse Supply. Procurement forecasts and Orderwise history. Tables stay closed; use the public functions.';

-- Active so module levels resolve. The app nav stays coming-soon until the Supply screens ship.
update core.pulses
set status = 'active'
where id = 'supply';

-- ---------------------------------------------------------------------------
-- Settings. One row. Sync cursors live here so a nightly run can resume.
-- ---------------------------------------------------------------------------

create table supply.settings (
  id boolean primary key default true,
  service_level numeric(4, 3) not null default 0.950,
  review_days integer not null default 14,
  default_lead_time_days integer not null default 14,
  forecast_months integer not null default 6,
  zero_stock_alert boolean not null default true,
  stock_location text,
  sma_window integer not null default 6,
  croston_alpha numeric(4, 3) not null default 0.200,
  initial_lookback_months integer not null default 36,
  sync_phase text not null default 'idle',
  products_page integer not null default 1,
  suppliers_page integer not null default 1,
  availability_page integer not null default 1,
  sales_page integer not null default 1,
  purchases_page integer not null default 1,
  forecast_offset integer not null default 0,
  forecast_run_id uuid,
  sales_since timestamptz,
  purchases_since timestamptz,
  run_started_at timestamptz,
  last_sync_started_at timestamptz,
  last_sync_finished_at timestamptz,
  last_sync_calls integer not null default 0,
  last_sync_error text,
  updated_at timestamptz not null default now(),
  constraint settings_singleton check (id),
  constraint settings_service_level_range check (service_level between 0.500 and 0.999),
  constraint settings_review_days_range check (review_days between 1 and 365),
  constraint settings_lead_time_range check (default_lead_time_days between 0 and 365),
  constraint settings_forecast_months_range check (forecast_months between 1 and 24),
  constraint settings_sma_window_range check (sma_window between 1 and 36),
  constraint settings_alpha_range check (croston_alpha between 0.010 and 0.900),
  constraint settings_lookback_range check (initial_lookback_months between 1 and 180),
  constraint settings_sync_phase_check check (sync_phase in ('idle', 'products', 'suppliers', 'availability', 'sales', 'purchases', 'forecast')),
  constraint settings_pages_check check (
    products_page >= 1 and suppliers_page >= 1 and availability_page >= 1
    and sales_page >= 1 and purchases_page >= 1 and forecast_offset >= 0
    and last_sync_calls >= 0
  ),
  constraint settings_location_length check (stock_location is null or char_length(stock_location) <= 80),
  constraint settings_error_length check (last_sync_error is null or char_length(last_sync_error) <= 300)
);

comment on column supply.settings.initial_lookback_months is
  'First Cin7 sales and purchase pull. Later runs use sales_since and purchases_since.';
comment on column supply.settings.stock_location is
  'When set, stock is read for this Cin7 location only. Null sums every location.';

insert into supply.settings (id) values (true);

create trigger settings_touch_updated_at
before update on supply.settings
for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Suppliers, SKU settings, stock, demand, purchases, aliases.
-- ---------------------------------------------------------------------------

create table supply.suppliers (
  id uuid primary key default gen_random_uuid(),
  cin7_supplier_id text,
  name text not null,
  lead_time_days integer,
  moq numeric(14, 3),
  order_multiple numeric(14, 3),
  currency text not null default 'GBP',
  notes text,
  active boolean not null default true,
  source text not null default 'manual',
  batch_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint suppliers_name_length check (char_length(btrim(name)) between 1 and 160),
  constraint suppliers_cin7_id_length check (cin7_supplier_id is null or char_length(cin7_supplier_id) <= 80),
  constraint suppliers_lead_time_range check (lead_time_days is null or lead_time_days between 0 and 365),
  constraint suppliers_moq_range check (moq is null or moq >= 0),
  constraint suppliers_multiple_range check (order_multiple is null or order_multiple >= 0),
  constraint suppliers_currency_check check (currency ~ '^[A-Z]{3}$'),
  constraint suppliers_notes_length check (notes is null or char_length(notes) <= 2000),
  constraint suppliers_source_check check (source in ('manual', 'cin7', 'orderwise'))
);

create unique index suppliers_cin7_uidx
  on supply.suppliers (cin7_supplier_id)
  where cin7_supplier_id is not null;
create index suppliers_name_idx on supply.suppliers (lower(name));
create index suppliers_batch_idx on supply.suppliers (batch_id) where batch_id is not null;

create trigger suppliers_touch_updated_at
before update on supply.suppliers
for each row execute function public.touch_updated_at();

create table supply.sku_settings (
  sku text primary key,
  label text,
  supplier_id uuid references supply.suppliers (id) on delete set null,
  lead_time_days integer,
  lead_time_source text,
  moq numeric(14, 3),
  order_multiple numeric(14, 3),
  safety_days integer,
  exclude boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint sku_settings_sku_length check (char_length(btrim(sku)) between 1 and 80),
  constraint sku_settings_label_length check (label is null or char_length(label) <= 200),
  constraint sku_settings_lead_source_check check (lead_time_source is null or lead_time_source in ('manual', 'cin7', 'orderwise_po')),
  constraint sku_settings_lead_time_range check (lead_time_days is null or lead_time_days between 0 and 365),
  constraint sku_settings_moq_range check (moq is null or moq >= 0),
  constraint sku_settings_multiple_range check (order_multiple is null or order_multiple >= 0),
  constraint sku_settings_safety_range check (safety_days is null or safety_days between 0 and 365)
);

create index sku_settings_supplier_idx on supply.sku_settings (supplier_id);

create trigger sku_settings_touch_updated_at
before update on supply.sku_settings
for each row execute function public.touch_updated_at();

create table supply.stock_snapshots (
  id uuid primary key default gen_random_uuid(),
  sku text not null,
  on_hand numeric(14, 3) not null default 0,
  allocated numeric(14, 3) not null default 0,
  available numeric(14, 3) not null default 0,
  on_order numeric(14, 3) not null default 0,
  captured_at timestamptz not null,
  captured_on date generated always as ((captured_at at time zone 'Europe/London')::date) stored,
  constraint stock_snapshots_sku_length check (char_length(btrim(sku)) between 1 and 80),
  constraint stock_snapshots_non_negative check (on_hand >= 0 and allocated >= 0 and available >= 0 and on_order >= 0),
  unique (sku, captured_on)
);

create index stock_snapshots_latest_idx on supply.stock_snapshots (sku, captured_at desc);

comment on table supply.stock_snapshots is
  'One row per SKU per Europe/London day. A later sync the same day replaces it.';

-- Per-location rows for the availability sync in progress. Folded into stock_snapshots, then cleared.
create table supply.stock_location_stage (
  sku text not null,
  location text not null default '',
  on_hand numeric(14, 3) not null default 0,
  allocated numeric(14, 3) not null default 0,
  available numeric(14, 3) not null default 0,
  on_order numeric(14, 3) not null default 0,
  primary key (sku, location),
  constraint stock_stage_sku_length check (char_length(btrim(sku)) between 1 and 80),
  constraint stock_stage_location_length check (char_length(location) <= 80),
  constraint stock_stage_non_negative check (on_hand >= 0 and allocated >= 0 and available >= 0 and on_order >= 0)
);

create table supply.import_mappings (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null,
  columns jsonb not null default '{}'::jsonb,
  date_format text not null default 'dd/mm/yyyy',
  delimiter text not null default ',',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint import_mappings_name_length check (char_length(btrim(name)) between 1 and 80),
  constraint import_mappings_kind_check check (kind in ('sales_lines', 'purchase_lines', 'suppliers')),
  constraint import_mappings_date_format_check check (date_format in ('dd/mm/yyyy', 'dd/mm/yy', 'yyyy-mm-dd')),
  constraint import_mappings_delimiter_check check (delimiter in (',', ';', E'\t'))
);

create trigger import_mappings_touch_updated_at
before update on supply.import_mappings
for each row execute function public.touch_updated_at();

create table supply.import_batches (
  id uuid primary key default gen_random_uuid(),
  mapping_id uuid references supply.import_mappings (id) on delete set null,
  file_path text,
  status text not null default 'pending',
  rows_read integer not null default 0,
  rows_loaded integer not null default 0,
  rows_unmatched integer not null default 0,
  errors jsonb not null default '[]'::jsonb,
  undo jsonb not null default '[]'::jsonb,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint import_batches_status_check check (status in ('pending', 'loading', 'loaded', 'failed')),
  constraint import_batches_counts_check check (rows_read >= 0 and rows_loaded >= 0 and rows_unmatched >= 0),
  constraint import_batches_path_length check (file_path is null or char_length(file_path) <= 300)
);

create index import_batches_created_idx on supply.import_batches (created_at desc);

create trigger import_batches_touch_updated_at
before update on supply.import_batches
for each row execute function public.touch_updated_at();

alter table supply.suppliers
  add constraint suppliers_batch_fk
  foreign key (batch_id) references supply.import_batches (id) on delete cascade;

create table supply.demand_monthly (
  id uuid primary key default gen_random_uuid(),
  sku text not null,
  month date not null,
  qty numeric(14, 3) not null,
  order_count integer not null default 0,
  source text not null,
  batch_id uuid references supply.import_batches (id) on delete cascade,
  constraint demand_sku_length check (char_length(btrim(sku)) between 1 and 80),
  constraint demand_month_start check (month = date_trunc('month', month)::date),
  constraint demand_qty_check check (qty >= 0 and order_count >= 0),
  constraint demand_source_check check (source in ('cin7', 'orderwise')),
  constraint demand_batch_source_check check ((source = 'cin7') = (batch_id is null))
);

-- Cin7 is one series. Orderwise keeps one row per file so batch removal is exact.
create unique index demand_monthly_cin7_uidx
  on supply.demand_monthly (sku, month)
  where source = 'cin7';
create unique index demand_monthly_batch_uidx
  on supply.demand_monthly (sku, month, batch_id)
  where batch_id is not null;
create index demand_monthly_sku_idx on supply.demand_monthly (sku, month);

comment on table supply.demand_monthly is
  'Cin7: one row per SKU and month. Orderwise: one row per SKU, month, and import batch.';

-- Lines behind the Cin7 monthly totals, so an updated sale replaces its own quantity.
create table supply.cin7_sale_lines (
  sale_id text not null,
  sku text not null,
  month date not null,
  qty numeric(14, 3) not null,
  primary key (sale_id, sku),
  constraint cin7_sale_lines_id_length check (char_length(sale_id) between 1 and 80),
  constraint cin7_sale_lines_sku_length check (char_length(btrim(sku)) between 1 and 80),
  constraint cin7_sale_lines_month_start check (month = date_trunc('month', month)::date),
  constraint cin7_sale_lines_qty_check check (qty >= 0)
);

create index cin7_sale_lines_sku_month_idx on supply.cin7_sale_lines (sku, month);

create table supply.po_history (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  po_ref text not null,
  supplier_key text,
  sku text not null,
  qty numeric(14, 3) not null,
  ordered_on date,
  received_on date,
  batch_id uuid references supply.import_batches (id) on delete cascade,
  constraint po_history_source_check check (source in ('cin7', 'orderwise')),
  constraint po_history_ref_length check (char_length(btrim(po_ref)) between 1 and 80),
  constraint po_history_sku_length check (char_length(btrim(sku)) between 1 and 80),
  constraint po_history_supplier_length check (supplier_key is null or char_length(supplier_key) <= 160),
  constraint po_history_qty_check check (qty >= 0),
  constraint po_history_batch_source_check check ((source = 'cin7') = (batch_id is null)),
  constraint po_history_received_after check (received_on is null or ordered_on is null or received_on >= ordered_on)
);

create unique index po_history_cin7_uidx
  on supply.po_history (po_ref, sku)
  where source = 'cin7';
create index po_history_sku_idx on supply.po_history (sku);
create index po_history_batch_idx on supply.po_history (batch_id) where batch_id is not null;

create table supply.sku_aliases (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  external_code text not null,
  sku text not null,
  constraint sku_aliases_source_check check (source in ('orderwise', 'cin7')),
  constraint sku_aliases_code_length check (char_length(btrim(external_code)) between 1 and 80),
  constraint sku_aliases_sku_length check (char_length(btrim(sku)) between 1 and 80),
  unique (source, external_code)
);

create index sku_aliases_sku_idx on supply.sku_aliases (sku);

create table supply.import_unmatched (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references supply.import_batches (id) on delete cascade,
  external_code text not null,
  qty numeric(14, 3) not null default 0,
  constraint import_unmatched_code_length check (char_length(btrim(external_code)) between 1 and 80),
  constraint import_unmatched_qty_check check (qty >= 0),
  unique (batch_id, external_code)
);

-- ---------------------------------------------------------------------------
-- Forecasts and reorder suggestions from the latest completed run.
-- ---------------------------------------------------------------------------

create table supply.forecast_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  settings jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles (id) on delete set null
);

create index forecast_runs_finished_idx
  on supply.forecast_runs (finished_at desc)
  where finished_at is not null;

alter table supply.settings
  add constraint settings_forecast_run_fk
  foreign key (forecast_run_id) references supply.forecast_runs (id) on delete set null;

create table supply.forecasts (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references supply.forecast_runs (id) on delete cascade,
  sku text not null,
  method text not null,
  month date not null,
  qty numeric(14, 3) not null,
  constraint forecasts_sku_length check (char_length(btrim(sku)) between 1 and 80),
  constraint forecasts_method_check check (method in ('sma', 'sba', 'seasonal_sma', 'seasonal_sba')),
  constraint forecasts_month_start check (month = date_trunc('month', month)::date),
  constraint forecasts_qty_check check (qty >= 0),
  unique (run_id, sku, month)
);

create index forecasts_run_sku_idx on supply.forecasts (run_id, sku);

create table supply.reorder_suggestions (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references supply.forecast_runs (id) on delete cascade,
  supplier_id uuid references supply.suppliers (id) on delete set null,
  sku text not null,
  on_hand numeric(14, 3) not null default 0,
  available numeric(14, 3) not null default 0,
  on_order numeric(14, 3) not null default 0,
  reorder_point numeric(14, 3) not null default 0,
  suggested_qty numeric(14, 3) not null default 0,
  reason text not null default '',
  zero_stock boolean not null default false,
  below_reorder boolean not null default false,
  overstock boolean not null default false,
  constraint reorder_sku_length check (char_length(btrim(sku)) between 1 and 80),
  constraint reorder_numbers_check check (
    on_hand >= 0 and available >= 0 and on_order >= 0 and reorder_point >= 0 and suggested_qty >= 0
  ),
  constraint reorder_reason_length check (char_length(reason) <= 200),
  unique (run_id, sku)
);

create index reorder_run_supplier_idx on supply.reorder_suggestions (run_id, supplier_id);

-- ---------------------------------------------------------------------------
-- Private import files. The browser uploads with a signed URL.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit)
values ('supply-imports', 'supply-imports', false, 52428800)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit;

revoke all on all tables in schema supply from public, anon, authenticated;
grant select, insert, update, delete on all tables in schema supply to authenticated;
grant all on all tables in schema supply to service_role;
