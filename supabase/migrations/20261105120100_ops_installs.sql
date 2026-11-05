-- Orbit Operations / Installs schema skeleton (M0).
-- Depends on 20261105120000_orbit_core.sql.
-- Tables and the install_job state machine only. No Cin7 calls, no invented
-- field mappings. Quote/order numbers, segment tags, and webhooks stay open
-- (OPEN #9) and are nullable text until that answer lands.
-- Do not apply to production until this migration has been reviewed.

create schema ops;

revoke all on schema ops from public;
grant usage on schema ops to postgres, authenticated, service_role;

comment on schema ops is
  'Orbit Operations (Installs). Cin7 ids are stored as text keys, not mapped fields.';

-- ---------------------------------------------------------------------------
-- Enums. job_status matches the Sprint 1 state machine, including the two
-- manual side states.
-- ---------------------------------------------------------------------------

create type ops.job_status as enum (
  'priced',
  'sub_price_pending',
  'ordered',
  'awaiting_access',
  'variation',
  'ready_to_book',
  'booked',
  'in_build',
  'ready_to_dispatch',
  'on_site',
  'completed',
  'closed',
  'on_hold',
  'lost_cancelled'
);

create type ops.job_type as enum ('install', 'revisit', 'service', 'collection');

create type ops.customer_segment as enum (
  'independent',
  'franchisee',
  'trade',
  'big_corporate'
);

create type ops.customer_type as enum ('credit', 'proforma', 'leasing');

create type ops.delivered_by as enum ('in_house', 'subcontractor');

create type ops.quote_mode as enum ('A', 'B', 'C', 'C_SUB');

create type ops.resource_type as enum (
  'installer',
  'driver',
  'helper',
  'van',
  'climber',
  'subcontractor'
);

create type ops.reservation_kind as enum ('pencil', 'firm');

-- ---------------------------------------------------------------------------
-- Customers and sites. Segment and customer type stay null until Cin7 #9.
-- ---------------------------------------------------------------------------

create table ops.customers (
  id uuid primary key default gen_random_uuid(),
  cin7_id text not null unique,
  name text not null,
  customer_type ops.customer_type,
  segment ops.customer_segment,
  cin7_segment_raw text,
  cin7_type_raw text,
  owner_rep_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column ops.customers.segment is
  'Resolved segment. Null blocks pricing. Source field in Cin7 is OPEN #9.';

comment on column ops.customers.customer_type is
  'Resolved credit / proforma / leasing. Source field in Cin7 is OPEN #9.';

comment on column ops.customers.cin7_segment_raw is
  'CIN7 GAP: raw tag or field kept for mapping. Do not invent the source.';

comment on column ops.customers.cin7_type_raw is
  'CIN7 GAP: raw customer-type value. Do not invent the source.';

create trigger customers_touch_updated_at
before update on ops.customers
for each row execute function public.touch_updated_at();

create table ops.sites (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references ops.customers (id) on delete restrict,
  name text,
  address_line1 text,
  address_line2 text,
  city text,
  postcode text not null,
  country text not null default 'GB',
  town_city_centre boolean,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index sites_customer_idx on ops.sites (customer_id);
create index sites_postcode_idx on ops.sites (postcode);

create trigger sites_touch_updated_at
before update on ops.sites
for each row execute function public.touch_updated_at();

create table ops.site_contacts (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references ops.sites (id) on delete cascade,
  name text not null,
  phone text,
  email text,
  role text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);

create index site_contacts_site_idx on ops.site_contacts (site_id);

comment on table ops.site_contacts is
  'Customer phone and email. HQ build does not get a select policy on this table.';

-- ---------------------------------------------------------------------------
-- Pricing, terms, effort table. Append-only pricing. Effort rows are not
-- seeded: Cin7 SKUs are blank until Alex supplies them.
-- ---------------------------------------------------------------------------

create table ops.pricing_settings (
  id uuid primary key default gen_random_uuid(),
  version integer not null check (version > 0),
  markup_independent numeric(5,4) not null default 0.40,
  markup_franchisee numeric(5,4) not null default 0.40,
  markup_trade numeric(5,4) not null default 0.50,
  markup_big_corporate numeric(5,4) not null default 0.80,
  min_job_charge numeric(12,2),
  margin_floor_pct numeric(5,4),
  custom_deposit_fraction numeric(5,4) not null default 0.3333,
  large_order_threshold numeric(12,2) not null default 50000,
  variation_rounding_hours numeric(4,2) not null default 0.5,
  changed_by uuid references public.profiles (id) on delete set null,
  change_reason text,
  created_at timestamptz not null default now(),
  unique (version)
);

comment on table ops.pricing_settings is
  'Owner-only writes. Append a version; never update in place. This is the home for markups.';

comment on column ops.pricing_settings.min_job_charge is
  'Null means not configured (OPEN #1). Do not block other work.';

comment on column ops.pricing_settings.margin_floor_pct is
  'Null means not configured (OPEN #2).';

create or replace function ops.enforce_pricing_version()
returns trigger
language plpgsql
set search_path = ops, public
as $$
declare
  v_max integer;
begin
  select coalesce(max(version), 0) into v_max from ops.pricing_settings;
  if new.version <> v_max + 1 then
    raise exception 'app: Pricing settings version must be the next version.';
  end if;
  return new;
end;
$$;

create trigger pricing_settings_enforce_version
before insert on ops.pricing_settings
for each row execute function ops.enforce_pricing_version();

create or replace function ops.prevent_pricing_settings_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'ops.pricing_settings is immutable; insert a new version';
end;
$$;

create trigger pricing_settings_immutable
before update or delete on ops.pricing_settings
for each row execute function ops.prevent_pricing_settings_mutation();

create or replace function ops.audit_pricing_settings_version()
returns trigger
language plpgsql
security definer
set search_path = ops, core, public
as $$
declare
  v_old jsonb;
begin
  select to_jsonb(p) - 'id' into v_old
  from ops.pricing_settings p
  where p.version < new.version
  order by p.version desc
  limit 1;

  insert into core.audit_log (
    actor_id, module_id, entity_schema, entity_table, entity_id,
    action, field_name, old_value, new_value, details
  ) values (
    coalesce(new.changed_by, auth.uid()),
    'operations',
    'ops',
    'pricing_settings',
    new.id,
    case when v_old is null then 'insert' else 'update' end,
    'pricing_settings',
    v_old,
    to_jsonb(new) - 'id',
    jsonb_build_object('version', new.version, 'reason', new.change_reason)
  );

  return new;
end;
$$;

create trigger pricing_settings_audit_version
after insert on ops.pricing_settings
for each row execute function ops.audit_pricing_settings_version();

create table ops.terms_versions (
  id uuid primary key default gen_random_uuid(),
  version_label text not null unique,
  document_file_id uuid references core.files (id) on delete set null,
  charges_grid jsonb not null,
  cancellation_schedule jsonb not null,
  is_live boolean not null default false,
  created_at timestamptz not null default now()
);

comment on table ops.terms_versions is
  'Versioned charges grid and cancellation schedule. Not marked live until OPEN #10.';

create table ops.effort_table_versions (
  id uuid primary key default gen_random_uuid(),
  version_label text not null unique,
  source_path text,
  created_at timestamptz not null default now()
);

create table ops.effort_rows (
  id uuid primary key default gen_random_uuid(),
  table_version_id uuid not null references ops.effort_table_versions (id) on delete cascade,
  cin7_sku text,
  product_name text not null,
  category text,
  unit_weight_kg numeric(10,2),
  assembled_weight_kg numeric(10,2),
  build_minutes numeric(10,2),
  install_minutes numeric(10,2),
  handling_minutes numeric(10,2),
  hq_build boolean not null default false,
  review_flag boolean not null default false,
  extras jsonb not null default '{}'::jsonb,
  unique (table_version_id, product_name)
);

create index effort_rows_sku_idx on ops.effort_rows (cin7_sku)
  where cin7_sku is not null;

comment on column ops.effort_rows.cin7_sku is
  'BLOCKED: leave null until Alex supplies Cin7 SKUs. Do not invent them.';

-- ---------------------------------------------------------------------------
-- Jobs. status is not client-writable.
-- ---------------------------------------------------------------------------

create table ops.install_jobs (
  id uuid primary key default gen_random_uuid(),
  cin7_quote_number text,
  cin7_order_number text,
  cin7_number text,
  job_type ops.job_type not null default 'install',
  parent_job_id uuid references ops.install_jobs (id) on delete set null,
  customer_id uuid not null references ops.customers (id) on delete restrict,
  site_id uuid references ops.sites (id) on delete set null,
  owner_rep_id uuid references public.profiles (id) on delete set null,
  status ops.job_status not null default 'priced',
  delivered_by ops.delivered_by not null default 'in_house',
  subcontractor_id uuid,
  big_install boolean not null default false,
  big_install_triggers text[] not null default '{}',
  requested_date date,
  booked_date date,
  arrival_window text,
  hold_reason text,
  hold_review_date date,
  lost_reason text,
  pricer_version text,
  effort_table_version_id uuid references ops.effort_table_versions (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint install_jobs_cin7_key check (
    cin7_number is not null
    or cin7_quote_number is not null
    or cin7_order_number is not null
    or job_type in ('revisit', 'service', 'collection')
  )
);

create unique index install_jobs_cin7_number_uidx
  on ops.install_jobs (cin7_number) where cin7_number is not null;
create index install_jobs_status_idx on ops.install_jobs (status);
create index install_jobs_customer_idx on ops.install_jobs (customer_id);
create index install_jobs_booked_date_idx on ops.install_jobs (booked_date);
create index install_jobs_parent_idx on ops.install_jobs (parent_job_id);

create trigger install_jobs_touch_updated_at
before update on ops.install_jobs
for each row execute function public.touch_updated_at();

create or replace function ops.protect_job_status()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status then
    if current_setting('ops.allow_status_change', true) is distinct from 'on'
       and coalesce(auth.role(), '') <> 'service_role' then
      raise exception 'ops.install_jobs.status is not client-writable; use ops.try_advance';
    end if;
  end if;
  return new;
end;
$$;

create trigger install_jobs_protect_status
before update on ops.install_jobs
for each row execute function ops.protect_job_status();

create trigger install_jobs_audit_row
after insert or update or delete on ops.install_jobs
for each row execute function core.audit_row_change();

comment on column ops.install_jobs.status is
  'Server-only. Authenticated clients are not granted UPDATE on this column. ops.try_advance is the manual path.';

comment on column ops.install_jobs.cin7_number is
  'CIN7 GAP: confirm whether quote number equals order number before relying on this key.';

comment on column ops.install_jobs.cin7_quote_number is
  'CIN7 GAP: stored separately until OPEN #9 confirms numbering.';

comment on column ops.install_jobs.cin7_order_number is
  'CIN7 GAP: stored separately until OPEN #9 confirms numbering.';

create table ops.job_lines (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references ops.install_jobs (id) on delete cascade,
  cin7_sku text not null,
  description text,
  qty numeric(12,2) not null check (qty > 0),
  build_location text check (build_location in ('site', 'hq')),
  category text,
  unit_weight_kg numeric(10,2),
  effort_row_id uuid references ops.effort_rows (id) on delete set null,
  provisional boolean not null default false,
  created_at timestamptz not null default now()
);

create index job_lines_job_idx on ops.job_lines (job_id);
create index job_lines_sku_idx on ops.job_lines (cin7_sku);

create table ops.quote_versions (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references ops.install_jobs (id) on delete cascade,
  mode ops.quote_mode not null,
  inputs jsonb not null,
  pricer_version text not null,
  effort_table_version_id uuid references ops.effort_table_versions (id) on delete set null,
  pricing_settings_version integer,
  internal_cost numeric(12,2),
  customer_price numeric(12,2),
  markup_applied numeric(5,4),
  segment ops.customer_segment,
  finality text not null check (finality in ('final', 'provisional')),
  provisional_items jsonb not null default '[]'::jsonb,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index quote_versions_job_idx
  on ops.quote_versions (job_id, created_at desc);

-- Sales read this view. Cost, markup, and inputs are not on it.
create or replace view ops.quote_customer_prices
with (security_barrier = true, security_invoker = false) as
select
  q.id,
  q.job_id,
  q.mode,
  q.customer_price,
  q.finality,
  q.segment,
  q.provisional_items,
  q.created_at
from ops.quote_versions q
join ops.install_jobs j on j.id = q.job_id
where core.has_ops_role(array['sales'])
  and j.owner_rep_id = auth.uid();

comment on view ops.quote_customer_prices is
  'Customer price for the signed-in salesperson''s own jobs. Cost and markup are omitted.';

create table ops.quote_costs (
  quote_version_id uuid primary key references ops.quote_versions (id) on delete cascade,
  cost_breakdown jsonb not null,
  margin_floor_price numeric(12,2),
  created_at timestamptz not null default now()
);

comment on table ops.quote_costs is
  'Install lead and owner only. Sales use ops.quote_customer_prices.';

create table ops.variations (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references ops.install_jobs (id) on delete cascade,
  quote_version_id uuid references ops.quote_versions (id) on delete set null,
  grid_lines jsonb not null default '[]'::jsonb,
  customer_amount numeric(12,2),
  internal_delta numeric(12,2),
  terms_version_id uuid references ops.terms_versions (id) on delete set null,
  confirmed_at timestamptz,
  confirmed_by_name text,
  created_at timestamptz not null default now()
);

create index variations_job_idx on ops.variations (job_id);

create table ops.payment_gates (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references ops.install_jobs (id) on delete cascade,
  rule text not null,
  status text not null default 'pending'
    check (status in ('pending', 'cleared', 'waived', 'failed')),
  evidence_file_id uuid references core.files (id) on delete set null,
  deposit_amount numeric(12,2),
  deposit_date date,
  confirmed_by uuid references public.profiles (id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index payment_gates_job_idx on ops.payment_gates (job_id);

create trigger payment_gates_touch_updated_at
before update on ops.payment_gates
for each row execute function public.touch_updated_at();

create table ops.portal_links (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references ops.install_jobs (id) on delete cascade,
  token_link_id uuid not null references core.token_links (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (job_id, token_link_id)
);

create table ops.access_submissions (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references ops.install_jobs (id) on delete cascade,
  answers jsonb not null,
  media_file_ids uuid[] not null default '{}',
  terms_version_id uuid references ops.terms_versions (id) on delete set null,
  accepted_at timestamptz,
  accepted_by_name text,
  accepted_ip inet,
  accepted_user_agent text,
  submitted_by text check (submitted_by in ('customer', 'rep_assisted')),
  created_at timestamptz not null default now()
);

create index access_submissions_job_idx
  on ops.access_submissions (job_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Resources, calendar, delivery, fleet.
-- ---------------------------------------------------------------------------

create table ops.resources (
  id uuid primary key default gen_random_uuid(),
  resource_type ops.resource_type not null,
  name text not null,
  profile_id uuid references public.profiles (id) on delete set null,
  has_licence boolean not null default false,
  insured boolean not null default false,
  insured_until date,
  van_payload_kg numeric(10,2),
  van_load_length_m numeric(6,2),
  climber_capacity_kg numeric(10,2),
  status text not null default 'active'
    check (status in ('active', 'inactive')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger resources_touch_updated_at
before update on ops.resources
for each row execute function public.touch_updated_at();

comment on column ops.resources.insured_until is
  'OPEN #7: Ben and Peter are not bookable as drivers until this date is set.';

create table ops.reservations (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references ops.resources (id) on delete restrict,
  job_id uuid not null references ops.install_jobs (id) on delete cascade,
  day date not null,
  kind ops.reservation_kind not null default 'pencil',
  created_at timestamptz not null default now(),
  unique (resource_id, day, job_id)
);

create index reservations_day_idx on ops.reservations (day, kind);
create index reservations_job_idx on ops.reservations (job_id);

create table ops.unavailability (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references ops.resources (id) on delete cascade,
  starts_on date not null,
  ends_on date not null,
  reason text not null check (reason in ('leave', 'sickness', 'off_road', 'service', 'mot', 'other')),
  notes text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on)
);

create index unavailability_resource_idx
  on ops.unavailability (resource_id, starts_on, ends_on);

create table ops.delivery_bookings (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references ops.install_jobs (id) on delete cascade,
  carrier text not null default 'lynnstar',
  delivery_date date,
  slot_label text,
  drop_zone text,
  manifest jsonb,
  d2_confirmed_at timestamptz,
  arrival_time timestamptz,
  booked_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index delivery_bookings_job_idx on ops.delivery_bookings (job_id);

create trigger delivery_bookings_touch_updated_at
before update on ops.delivery_bookings
for each row execute function public.touch_updated_at();

comment on column ops.delivery_bookings.booked_by is
  'OPEN: who books Lynnstar is not decided. No booking integration in M0.';

create table ops.van_checks (
  id uuid primary key default gen_random_uuid(),
  van_resource_id uuid not null references ops.resources (id) on delete restrict,
  checked_by uuid references public.profiles (id) on delete set null,
  checked_at timestamptz not null default now(),
  defects jsonb not null default '[]'::jsonb,
  result text not null check (result in ('pass', 'minor', 'safety_critical')),
  job_id uuid references ops.install_jobs (id) on delete set null
);

create index van_checks_van_idx on ops.van_checks (van_resource_id, checked_at desc);

comment on column ops.van_checks.defects is
  'OPEN #8: which defects are safety-critical is not seeded. Shape is [{code, severity, note}].';

create table ops.fleet_tasks (
  id uuid primary key default gen_random_uuid(),
  van_resource_id uuid not null references ops.resources (id) on delete restrict,
  van_check_id uuid references ops.van_checks (id) on delete set null,
  core_task_id uuid references core.tasks (id) on delete set null,
  defect jsonb not null,
  status text not null default 'open'
    check (status in ('open', 'in_progress', 'done', 'cancelled')),
  created_at timestamptz not null default now()
);

create table ops.qc_checklists (
  id uuid primary key default gen_random_uuid(),
  product_or_category text not null,
  items jsonb not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  unique (product_or_category, version)
);

create table ops.build_records (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references ops.install_jobs (id) on delete cascade,
  job_line_id uuid references ops.job_lines (id) on delete set null,
  serial text,
  builder_id uuid references public.profiles (id) on delete set null,
  minutes numeric(10,2),
  qc_checklist_id uuid references ops.qc_checklists (id) on delete set null,
  qc_answers jsonb,
  qc_result text check (qc_result in ('pass', 'fail', 'pending')),
  photo_file_ids uuid[] not null default '{}',
  covered_and_decked boolean not null default false,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index build_records_job_idx on ops.build_records (job_id);
create index build_records_serial_idx on ops.build_records (serial);

create table ops.crate_counts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references ops.install_jobs (id) on delete cascade,
  crates_out integer not null default 0 check (crates_out >= 0),
  crates_back integer not null default 0 check (crates_back >= 0),
  recorded_at timestamptz not null default now(),
  recorded_by uuid references public.profiles (id) on delete set null
);

create index crate_counts_job_idx on ops.crate_counts (job_id);

create table ops.risk_assessments (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references ops.install_jobs (id) on delete cascade,
  answers jsonb not null,
  completed_by uuid references public.profiles (id) on delete set null,
  completed_at timestamptz not null default now()
);

create table ops.job_sheets (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null unique references ops.install_jobs (id) on delete cascade,
  template_kind ops.job_type not null default 'install',
  steps_state jsonb not null default '{}'::jsonb,
  protected_route_photo_id uuid references core.files (id) on delete set null,
  lynnstar_arrival_at timestamptz,
  walkthrough_done boolean not null default false,
  leave_behind_ticks jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger job_sheets_touch_updated_at
before update on ops.job_sheets
for each row execute function public.touch_updated_at();

create table ops.job_day_logs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references ops.install_jobs (id) on delete cascade,
  day date not null,
  crew_profile_ids uuid[] not null default '{}',
  started_at timestamptz,
  finished_at timestamptz,
  progress_notes text,
  photo_file_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (job_id, day)
);

create index job_day_logs_job_idx on ops.job_day_logs (job_id, day);

create table ops.machine_checks (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references ops.install_jobs (id) on delete cascade,
  job_line_id uuid references ops.job_lines (id) on delete set null,
  build_record_id uuid references ops.build_records (id) on delete set null,
  serial text,
  tag_number text,
  cover_fitted boolean not null default false,
  checklist jsonb,
  photo_file_ids uuid[] not null default '{}',
  completed_by uuid references public.profiles (id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index machine_checks_job_idx on ops.machine_checks (job_id);

create table ops.snags (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references ops.install_jobs (id) on delete cascade,
  machine_check_id uuid references ops.machine_checks (id) on delete set null,
  description text not null,
  photo_file_ids uuid[] not null default '{}',
  status text not null default 'open'
    check (status in ('open', 'resolved', 'revisit_linked')),
  revisit_job_id uuid references ops.install_jobs (id) on delete set null,
  created_at timestamptz not null default now()
);

create index snags_job_idx on ops.snags (job_id, status);

create table ops.signatures (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references ops.install_jobs (id) on delete cascade,
  signer_name text,
  signed_at timestamptz,
  signature_file_id uuid references core.files (id) on delete set null,
  pdf_file_id uuid references core.files (id) on delete set null,
  no_signatory_reason text,
  no_signatory_photo_id uuid references core.files (id) on delete set null,
  created_at timestamptz not null default now()
);

create index signatures_job_idx on ops.signatures (job_id);

create table ops.charge_events (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references ops.install_jobs (id) on delete cascade,
  grid_line text not null,
  amount numeric(12,2),
  evidence_photo_ids uuid[] not null default '{}',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create table ops.assets (
  id uuid primary key default gen_random_uuid(),
  site_id uuid references ops.sites (id) on delete set null,
  job_id uuid references ops.install_jobs (id) on delete set null,
  job_line_id uuid references ops.job_lines (id) on delete set null,
  build_record_id uuid references ops.build_records (id) on delete set null,
  product_name text,
  cin7_sku text,
  serial text,
  tag_number text,
  qc_photo_ids uuid[] not null default '{}',
  install_photo_ids uuid[] not null default '{}',
  signed_date date,
  warranty_start date,
  warranty_end date,
  installer_ids uuid[] not null default '{}',
  created_at timestamptz not null default now()
);

create index assets_site_idx on ops.assets (site_id);
create index assets_serial_idx on ops.assets (serial);
create index assets_job_idx on ops.assets (job_id);

comment on column ops.assets.warranty_start is
  'OPEN: Jordan and DHZ warranty terms are not decided.';

create table ops.subcontractors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact_name text,
  phone text,
  email text,
  regions text[] not null default '{}',
  capabilities text[] not null default '{}',
  insurance_file_id uuid references core.files (id) on delete set null,
  insurance_expires_on date,
  status text not null default 'active'
    check (status in ('active', 'inactive')),
  notes text,
  resource_id uuid references ops.resources (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger subcontractors_touch_updated_at
before update on ops.subcontractors
for each row execute function public.touch_updated_at();

alter table ops.install_jobs
  add constraint install_jobs_subcontractor_fkey
  foreign key (subcontractor_id) references ops.subcontractors (id) on delete set null;

create table ops.sub_quotes (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references ops.install_jobs (id) on delete cascade,
  subcontractor_id uuid not null references ops.subcontractors (id) on delete restrict,
  sub_price numeric(12,2),
  jordan_own_costs jsonb,
  customer_price numeric(12,2),
  dates_offered daterange,
  valid_until date,
  requested_at timestamptz,
  received_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index sub_quotes_job_idx on ops.sub_quotes (job_id);

create table ops.feedback (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references ops.install_jobs (id) on delete cascade,
  score integer check (score between 1 and 5),
  comments text,
  received_at timestamptz,
  chased_count integer not null default 0,
  created_at timestamptz not null default now()
);

create index feedback_job_idx on ops.feedback (job_id);

create table ops.revisit_causes (
  id uuid primary key default gen_random_uuid(),
  revisit_job_id uuid not null references ops.install_jobs (id) on delete cascade,
  asset_id uuid references ops.assets (id) on delete set null,
  root_cause text not null
    check (root_cause in ('product_defect', 'install_error', 'customer_misuse', 'access')),
  notes text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- try_advance. M0 handles manual on_hold and lost_cancelled only.
-- Every other event, including cin7_sales_order, returns the current status.
-- guard_name is not executed.
-- ---------------------------------------------------------------------------

create or replace function ops.try_advance(p_job_id uuid, p_event text default null)
returns ops.job_status
language plpgsql
security definer
set search_path = ops, core, public
as $$
declare
  v_job ops.install_jobs%rowtype;
  v_to text;
  v_manual boolean;
  v_terminal boolean;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not core.has_ops_role(array['install_lead', 'admin_owner'])
  then
    raise exception 'app: Only the install lead or owner can move a job.';
  end if;

  select * into v_job
  from ops.install_jobs
  where id = p_job_id
  for update;

  if not found then
    raise exception 'app: That job could not be found.';
  end if;

  if p_event is null or length(trim(p_event)) = 0 then
    return v_job.status;
  end if;

  select t.to_state, t.is_manual
  into v_to, v_manual
  from core.workflow_transitions t
  join core.workflow_definitions d on d.id = t.workflow_id
  where d.module_id = 'operations'
    and d.name = 'install_job'
    and t.event = trim(p_event)
    and (t.from_state = v_job.status::text or t.from_state = '*')
  order by case when t.from_state = v_job.status::text then 0 else 1 end
  limit 1;

  if not found or not coalesce(v_manual, false) then
    return v_job.status;
  end if;

  select s.is_terminal into v_terminal
  from core.workflow_states s
  join core.workflow_definitions d on d.id = s.workflow_id
  where d.module_id = 'operations'
    and d.name = 'install_job'
    and s.code = v_job.status::text;

  if coalesce(v_terminal, false) then
    raise exception 'app: This job is already closed.';
  end if;

  if v_to = 'on_hold' then
    if nullif(trim(coalesce(v_job.hold_reason, '')), '') is null
       or v_job.hold_review_date is null
    then
      raise exception 'app: On hold needs a reason and a review date.';
    end if;
  elsif v_to = 'lost_cancelled' then
    if nullif(trim(coalesce(v_job.lost_reason, '')), '') is null then
      raise exception 'app: Lost or cancelled needs a reason.';
    end if;
  else
    raise exception 'app: That manual move is not available.';
  end if;

  perform set_config('ops.allow_status_change', 'on', true);

  update ops.install_jobs
  set status = v_to::ops.job_status
  where id = p_job_id
  returning status into v_job.status;

  perform set_config('ops.allow_status_change', 'off', true);

  return v_job.status;
end;
$$;

comment on function ops.try_advance(uuid, text) is
  'M0 moves a job only for place_on_hold and mark_lost_cancelled. Other events, including Cin7, no-op.';

revoke all on function ops.try_advance(uuid, text) from public, anon;
grant execute on function ops.try_advance(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Visibility helpers. security definer so policies do not recurse through RLS.
-- ---------------------------------------------------------------------------

create or replace function ops.job_visible(p_job_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ops, core, public
as $$
  select exists (
    select 1
    from ops.install_jobs j
    where j.id = p_job_id
      and (
        core.has_ops_role(array['install_lead', 'admin_owner', 'hq'])
        or (
          core.has_ops_role(array['sales'])
          and j.owner_rep_id = auth.uid()
        )
        or (
          core.has_ops_role(array['installer'])
          and exists (
            select 1
            from ops.reservations r
            join ops.resources res on res.id = r.resource_id
            where r.job_id = j.id
              and res.profile_id = auth.uid()
              and r.day between current_date and current_date + 1
          )
        )
      )
  );
$$;

create or replace function ops.customer_visible(p_customer_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ops, core, public
as $$
  select exists (
    select 1
    from ops.customers c
    where c.id = p_customer_id
      and (
        core.has_ops_role(array['install_lead', 'admin_owner', 'hq'])
        or (
          core.has_ops_role(array['sales'])
          and (
            c.owner_rep_id = auth.uid()
            or exists (
              select 1
              from ops.install_jobs j
              where j.customer_id = c.id
                and j.owner_rep_id = auth.uid()
            )
          )
        )
      )
  );
$$;

create or replace function ops.site_visible(p_site_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ops, core, public
as $$
  select exists (
    select 1
    from ops.sites s
    where s.id = p_site_id
      and (
        core.has_ops_role(array['install_lead', 'admin_owner', 'hq'])
        or (
          core.has_ops_role(array['sales'])
          and ops.customer_visible(s.customer_id)
        )
        or (
          core.has_ops_role(array['installer'])
          and exists (
            select 1
            from ops.install_jobs j
            where j.site_id = s.id
              and ops.job_visible(j.id)
          )
        )
      )
  );
$$;

create or replace function ops.site_contact_visible(p_contact_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ops, core, public
as $$
  select exists (
    select 1
    from ops.site_contacts c
    join ops.sites s on s.id = c.site_id
    where c.id = p_contact_id
      and (
        core.has_ops_role(array['install_lead', 'admin_owner'])
        or (
          core.has_ops_role(array['sales'])
          and ops.customer_visible(s.customer_id)
        )
        or (
          core.has_ops_role(array['installer'])
          and exists (
            select 1
            from ops.install_jobs j
            where j.site_id = s.id
              and ops.job_visible(j.id)
          )
        )
      )
  );
$$;

create or replace function ops.sales_job_visible(p_job_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ops, core, public
as $$
  select exists (
    select 1
    from ops.install_jobs j
    where j.id = p_job_id
      and (
        core.has_ops_role(array['install_lead', 'admin_owner'])
        or (
          core.has_ops_role(array['sales'])
          and j.owner_rep_id = auth.uid()
        )
      )
  );
$$;

create or replace function ops.money_visible(p_job_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ops, core, public
as $$
  select core.has_ops_role(array['install_lead', 'admin_owner'])
    and exists (select 1 from ops.install_jobs j where j.id = p_job_id);
$$;

create or replace function ops.field_visible(p_job_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ops, core, public
as $$
  select exists (select 1 from ops.install_jobs j where j.id = p_job_id)
    and (
      core.has_ops_role(array['install_lead', 'admin_owner'])
      or (
        core.has_ops_role(array['installer'])
        and ops.job_visible(p_job_id)
      )
    );
$$;

create or replace function ops.build_visible(p_job_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ops, core, public
as $$
  select core.has_ops_role(array['install_lead', 'admin_owner', 'hq'])
    and exists (select 1 from ops.install_jobs j where j.id = p_job_id);
$$;

revoke all on function ops.job_visible(uuid) from public, anon;
revoke all on function ops.customer_visible(uuid) from public, anon;
revoke all on function ops.site_visible(uuid) from public, anon;
revoke all on function ops.site_contact_visible(uuid) from public, anon;
revoke all on function ops.sales_job_visible(uuid) from public, anon;
revoke all on function ops.money_visible(uuid) from public, anon;
revoke all on function ops.field_visible(uuid) from public, anon;
revoke all on function ops.build_visible(uuid) from public, anon;
revoke all on function ops.protect_job_status() from public, anon;
revoke all on function ops.enforce_pricing_version() from public, anon;
revoke all on function ops.prevent_pricing_settings_mutation() from public, anon;
revoke all on function ops.audit_pricing_settings_version() from public, anon;

grant execute on function ops.job_visible(uuid) to authenticated, service_role;
grant execute on function ops.customer_visible(uuid) to authenticated, service_role;
grant execute on function ops.site_visible(uuid) to authenticated, service_role;
grant execute on function ops.site_contact_visible(uuid) to authenticated, service_role;
grant execute on function ops.sales_job_visible(uuid) to authenticated, service_role;
grant execute on function ops.money_visible(uuid) to authenticated, service_role;
grant execute on function ops.field_visible(uuid) to authenticated, service_role;
grant execute on function ops.build_visible(uuid) to authenticated, service_role;
grant execute on function ops.protect_job_status() to authenticated, service_role;
grant execute on function ops.enforce_pricing_version() to authenticated, service_role;
grant execute on function ops.prevent_pricing_settings_mutation() to authenticated, service_role;
grant execute on function ops.audit_pricing_settings_version() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Row level security. Writes from authenticated are limited to hold / lost
-- reasons and a new pricing_settings version. Job creation stays on service_role.
-- ---------------------------------------------------------------------------

alter table ops.customers enable row level security;
alter table ops.sites enable row level security;
alter table ops.site_contacts enable row level security;
alter table ops.pricing_settings enable row level security;
alter table ops.terms_versions enable row level security;
alter table ops.effort_table_versions enable row level security;
alter table ops.effort_rows enable row level security;
alter table ops.install_jobs enable row level security;
alter table ops.job_lines enable row level security;
alter table ops.quote_versions enable row level security;
alter table ops.quote_costs enable row level security;
alter table ops.variations enable row level security;
alter table ops.payment_gates enable row level security;
alter table ops.portal_links enable row level security;
alter table ops.access_submissions enable row level security;
alter table ops.resources enable row level security;
alter table ops.reservations enable row level security;
alter table ops.unavailability enable row level security;
alter table ops.delivery_bookings enable row level security;
alter table ops.van_checks enable row level security;
alter table ops.fleet_tasks enable row level security;
alter table ops.qc_checklists enable row level security;
alter table ops.build_records enable row level security;
alter table ops.crate_counts enable row level security;
alter table ops.risk_assessments enable row level security;
alter table ops.job_sheets enable row level security;
alter table ops.job_day_logs enable row level security;
alter table ops.machine_checks enable row level security;
alter table ops.snags enable row level security;
alter table ops.signatures enable row level security;
alter table ops.charge_events enable row level security;
alter table ops.assets enable row level security;
alter table ops.subcontractors enable row level security;
alter table ops.sub_quotes enable row level security;
alter table ops.feedback enable row level security;
alter table ops.revisit_causes enable row level security;

revoke all on all tables in schema ops from public, anon, authenticated;
grant select on all tables in schema ops to authenticated;
grant all on all tables in schema ops to service_role;

revoke insert, update, delete, truncate on all tables in schema ops from authenticated;
grant update (hold_reason, hold_review_date, lost_reason) on table ops.install_jobs to authenticated;
grant insert on table ops.pricing_settings to authenticated;

revoke all on ops.quote_customer_prices from public, anon;
grant select on ops.quote_customer_prices to authenticated, service_role;

create policy "Read visible customers"
on ops.customers
for select
to authenticated
using (ops.customer_visible(id));

create policy "Read visible sites"
on ops.sites
for select
to authenticated
using (ops.site_visible(id));

create policy "Read visible site contacts"
on ops.site_contacts
for select
to authenticated
using (ops.site_contact_visible(id));

create policy "Leads read pricing settings"
on ops.pricing_settings
for select
to authenticated
using (core.has_ops_role(array['install_lead', 'admin_owner']));

create policy "Owner inserts the next pricing version"
on ops.pricing_settings
for insert
to authenticated
with check (core.is_ops_owner() and changed_by = auth.uid());

create policy "Staff read terms versions"
on ops.terms_versions
for select
to authenticated
using (core.has_ops_role(array['sales', 'install_lead', 'admin_owner', 'installer']));

create policy "Leads and HQ read effort versions"
on ops.effort_table_versions
for select
to authenticated
using (core.has_ops_role(array['install_lead', 'admin_owner', 'hq']));

create policy "Leads and HQ read effort rows"
on ops.effort_rows
for select
to authenticated
using (core.has_ops_role(array['install_lead', 'admin_owner', 'hq']));

create policy "Read visible jobs"
on ops.install_jobs
for select
to authenticated
using (ops.job_visible(id));

create policy "Leads update hold and lost reasons"
on ops.install_jobs
for update
to authenticated
using (core.has_ops_role(array['install_lead', 'admin_owner']))
with check (core.has_ops_role(array['install_lead', 'admin_owner']));

create policy "Read visible job lines"
on ops.job_lines
for select
to authenticated
using (ops.sales_job_visible(job_id) or ops.build_visible(job_id) or ops.field_visible(job_id));

create policy "Leads read quote versions"
on ops.quote_versions
for select
to authenticated
using (ops.money_visible(job_id));

create policy "Leads read quote costs"
on ops.quote_costs
for select
to authenticated
using (
  exists (
    select 1
    from ops.quote_versions q
    where q.id = quote_costs.quote_version_id
      and ops.money_visible(q.job_id)
  )
);

create policy "Leads read variations"
on ops.variations
for select
to authenticated
using (ops.money_visible(job_id));

create policy "Sales and leads read payment gates"
on ops.payment_gates
for select
to authenticated
using (ops.sales_job_visible(job_id));

create policy "Leads read portal links"
on ops.portal_links
for select
to authenticated
using (core.has_ops_role(array['install_lead', 'admin_owner']) and ops.job_visible(job_id));

create policy "Read visible access submissions"
on ops.access_submissions
for select
to authenticated
using (ops.sales_job_visible(job_id) or ops.field_visible(job_id));

create policy "Operations staff read resources"
on ops.resources
for select
to authenticated
using (core.has_ops_role(array['sales', 'install_lead', 'installer', 'hq', 'admin_owner']));

create policy "Read visible reservations"
on ops.reservations
for select
to authenticated
using (
  core.has_ops_role(array['install_lead', 'admin_owner', 'hq'])
  or (
    core.has_ops_role(array['installer'])
    and exists (
      select 1
      from ops.resources r
      where r.id = reservations.resource_id
        and r.profile_id = auth.uid()
    )
  )
  or (
    core.has_ops_role(array['sales'])
    and ops.sales_job_visible(job_id)
  )
);

create policy "Leads and HQ read unavailability"
on ops.unavailability
for select
to authenticated
using (core.has_ops_role(array['install_lead', 'admin_owner', 'hq']));

create policy "Read visible delivery bookings"
on ops.delivery_bookings
for select
to authenticated
using (
  ops.sales_job_visible(job_id)
  or ops.build_visible(job_id)
  or ops.field_visible(job_id)
);

create policy "Field staff read van checks"
on ops.van_checks
for select
to authenticated
using (core.has_ops_role(array['install_lead', 'admin_owner', 'hq', 'installer']));

create policy "Leads and HQ read fleet tasks"
on ops.fleet_tasks
for select
to authenticated
using (core.has_ops_role(array['install_lead', 'admin_owner', 'hq']));

create policy "Leads and HQ read QC checklists"
on ops.qc_checklists
for select
to authenticated
using (core.has_ops_role(array['install_lead', 'admin_owner', 'hq']));

create policy "Read visible build records"
on ops.build_records
for select
to authenticated
using (ops.build_visible(job_id));

create policy "Read visible crate counts"
on ops.crate_counts
for select
to authenticated
using (ops.build_visible(job_id) or ops.field_visible(job_id));

create policy "Read visible risk assessments"
on ops.risk_assessments
for select
to authenticated
using (ops.field_visible(job_id));

create policy "Read visible job sheets"
on ops.job_sheets
for select
to authenticated
using (ops.field_visible(job_id));

create policy "Read visible day logs"
on ops.job_day_logs
for select
to authenticated
using (ops.field_visible(job_id));

create policy "Read visible machine checks"
on ops.machine_checks
for select
to authenticated
using (ops.field_visible(job_id));

create policy "Read visible snags"
on ops.snags
for select
to authenticated
using (ops.field_visible(job_id));

create policy "Read visible signatures"
on ops.signatures
for select
to authenticated
using (ops.field_visible(job_id));

create policy "Leads read charge events"
on ops.charge_events
for select
to authenticated
using (ops.money_visible(job_id));

create policy "Read visible assets"
on ops.assets
for select
to authenticated
using (
  core.has_ops_role(array['install_lead', 'admin_owner', 'hq'])
  and (job_id is null or ops.build_visible(job_id))
);

create policy "Leads read subcontractors"
on ops.subcontractors
for select
to authenticated
using (core.has_ops_role(array['install_lead', 'admin_owner']));

create policy "Leads read sub quotes"
on ops.sub_quotes
for select
to authenticated
using (ops.money_visible(job_id));

create policy "Leads read feedback"
on ops.feedback
for select
to authenticated
using (core.has_ops_role(array['install_lead', 'admin_owner']) and ops.job_visible(job_id));

create policy "Leads read revisit causes"
on ops.revisit_causes
for select
to authenticated
using (core.has_ops_role(array['install_lead', 'admin_owner']));

-- Job-scoped file metadata for roles that are not the install lead.
create policy "Assigned roles read job file metadata"
on core.files
for select
to authenticated
using (
  (
    entity_schema = 'ops'
    and entity_table = 'install_jobs'
    and ops.job_visible(entity_id)
    and (
      (core.has_ops_role(array['hq']) and bucket in ('qc', 'job-sheets'))
      or (core.has_ops_role(array['installer']) and bucket in ('job-sheets', 'qc', 'access-media'))
      or (core.has_ops_role(array['sales']) and bucket in ('access-media', 'terms'))
    )
  )
  or (
    bucket = 'terms'
    and core.has_ops_role(array['sales', 'install_lead', 'installer', 'admin_owner'])
  )
);

-- ---------------------------------------------------------------------------
-- Owner settings read, and the M0 config seed.
-- ---------------------------------------------------------------------------

create or replace function public.orbit_read_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = core, ops, public
as $$
declare
  v_settings jsonb;
  v_pricing jsonb;
begin
  if not core.is_ops_owner() then
    raise exception 'app: Only the owner can read these settings.';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'key', s.key,
      'module_id', s.module_id,
      'value', s.value,
      'version', s.version,
      'changed_by', s.changed_by,
      'change_reason', s.change_reason,
      'created_at', s.created_at
    )
    order by s.key
  ), '[]'::jsonb)
  into v_settings
  from core.settings_current s;

  select jsonb_build_object(
    'version', p.version,
    'markup_independent', p.markup_independent,
    'markup_franchisee', p.markup_franchisee,
    'markup_trade', p.markup_trade,
    'markup_big_corporate', p.markup_big_corporate,
    'min_job_charge', p.min_job_charge,
    'margin_floor_pct', p.margin_floor_pct,
    'custom_deposit_fraction', p.custom_deposit_fraction,
    'large_order_threshold', p.large_order_threshold,
    'variation_rounding_hours', p.variation_rounding_hours,
    'change_reason', p.change_reason,
    'created_at', p.created_at
  )
  into v_pricing
  from ops.pricing_settings p
  order by p.version desc
  limit 1;

  return jsonb_build_object(
    'settings', coalesce(v_settings, '[]'::jsonb),
    'pricing_settings', v_pricing
  );
end;
$$;

revoke all on function public.orbit_read_settings() from public, anon;
grant execute on function public.orbit_read_settings() to authenticated, service_role;

insert into ops.pricing_settings (
  version,
  markup_independent,
  markup_franchisee,
  markup_trade,
  markup_big_corporate,
  min_job_charge,
  margin_floor_pct,
  custom_deposit_fraction,
  large_order_threshold,
  variation_rounding_hours,
  change_reason
) values (
  1,
  0.40,
  0.40,
  0.50,
  0.80,
  null,
  null,
  0.3333,
  50000,
  0.5,
  'M0 seed from Sprint 1 requirements. Minimum job charge (OPEN #1) and margin floor (OPEN #2) are not configured. Deposit fraction 0.3333 is the one-third assumption (OPEN #16).'
);

insert into ops.terms_versions (version_label, charges_grid, cancellation_schedule, is_live)
values (
  'v1-original',
  jsonb_build_object(
    'currency', 'GBP',
    'vat', 'ex',
    'source', 'Jordan Install T&Cs charges grid',
    'lines', jsonb_build_array(
      jsonb_build_object('label', 'Additional installer time, within agreed hours', 'rate', 30.00, 'unit', 'per installer per hour'),
      jsonb_build_object('label', 'Additional installer time, outside agreed hours', 'rate', 45.00, 'unit', 'per installer per hour'),
      jsonb_build_object('label', 'Site survey (where required)', 'rate', 250.00, 'mileage', 0.50, 'unit', 'flat plus per mile'),
      jsonb_build_object('label', 'Materials and consumables', 'basis', 'cost_plus_25'),
      jsonb_build_object('label', 'Abortive visit (site not ready, access refused, no signatory)', 'rate', 300.00, 'mileage', 0.50, 'unit', 'per crew day plus per mile'),
      jsonb_build_object('label', 'Equipment movement beyond the agreed floor plan', 'basis', 'additional_installer_time'),
      jsonb_build_object('label', 'Waste removal beyond packaging', 'rate', 45.00, 'unit', 'per collection'),
      jsonb_build_object('label', 'Parking, permits, congestion fees (clause 8)', 'basis', 'at_cost')
    )
  ),
  jsonb_build_object(
    'basis', 'installation price ex VAT',
    'reduced_when_crew_redeployed', true,
    'rows', jsonb_build_array(
      jsonb_build_object('notice', '11+ working days', 'charge_pct', 0),
      jsonb_build_object('notice', '6–10 working days', 'charge_pct', 25),
      jsonb_build_object('notice', '2–5 working days', 'charge_pct', 50),
      jsonb_build_object('notice', '1 working day or less, or on arrival', 'charge_pct', 100, 'plus_third_party_costs', true)
    )
  ),
  false
);

insert into ops.effort_table_versions (version_label, source_path)
values ('v2.5', 'reference/install-quoting/SKILL.md');

-- Cin7 gaps left open on purpose (OPEN #9 and the prep notes):
-- * customers.segment / customer_type source field or tag
-- * whether cin7 quote number equals order number
-- * webhook versus poll for quote to sales order
-- * write-back of the install line and best-case notice
-- * product weight from Cin7 versus effort_rows
-- * who books Lynnstar

notify pgrst, 'reload schema';
