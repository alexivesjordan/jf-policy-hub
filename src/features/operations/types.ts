export type OfficeContext = {
  has_module: boolean;
  ops_role: string | null;
  is_owner: boolean;
  operations?: "none" | "view" | "edit";
  sales?: "none" | "view" | "edit";
};

export type JobSummary = {
  id: string;
  status: string;
  status_label: string;
  job_type: string;
  cin7_number: string | null;
  cin7_order_number?: string | null;
  fixture: boolean;
  customer_name: string;
  customer_segment: string | null;
  customer_type: string | null;
  postcode: string | null;
  city: string | null;
  big_install: boolean;
  hold_reason: string | null;
  requested_date?: string | null;
  requested_end?: string | null;
  booked_date: string | null;
  created_at: string;
};

export type QuoteVersionSummary = {
  id: string;
  mode: string;
  finality: string;
  customer_price: number | null;
  internal_cost: number | null;
  created_at: string;
};

export type JobDetail = {
  id: string;
  status: string;
  status_label: string;
  job_type: string;
  cin7_number: string | null;
  cin7_quote_number: string | null;
  cin7_order_number: string | null;
  fixture: boolean;
  delivered_by: string;
  big_install: boolean;
  big_install_triggers: string[];
  requested_date: string | null;
  booked_date: string | null;
  arrival_window: string | null;
  hold_reason: string | null;
  hold_review_date: string | null;
  lost_reason: string | null;
  created_at: string;
  customer: {
    id: string;
    name: string;
    segment: string | null;
    customer_type: string | null;
    cin7_id: string;
  };
  site: {
    id: string;
    name: string | null;
    address_line1: string | null;
    city: string | null;
    postcode: string | null;
  } | null;
  quote_versions: QuoteVersionSummary[];
};

export type PricingSettings = {
  version: number;
  markup_independent: number;
  markup_franchisee: number;
  markup_trade: number;
  markup_big_corporate: number;
  min_job_charge: number | null;
  margin_floor_pct: number | null;
  custom_deposit_fraction: number;
  large_order_threshold: number;
  variation_rounding_hours: number;
  sled_track_width_m?: number | null;
  sled_base_minutes?: number | null;
  sled_base_length_m?: number | null;
  sled_extra_minutes_per_m?: number | null;
  change_reason: string | null;
  created_at: string;
};

export type TermsLine = {
  label: string;
  rate?: number | null;
  mileage?: number | null;
  unit?: string | null;
  basis?: string | null;
};

export type TermsVersion = {
  id: string;
  version_label: string;
  is_live: boolean;
  charges_grid: {
    currency?: string;
    vat?: string;
    lines: TermsLine[];
  };
  cancellation_schedule: {
    basis?: string;
    reduced_when_crew_redeployed?: boolean;
    rows?: { notice: string; charge_pct: number; plus_third_party_costs?: boolean }[];
  };
  created_at: string;
};

export type GateOverrideRow = {
  id: string;
  gate: string;
  reason: string;
  entity_schema: string;
  entity_table: string;
  entity_id: string;
  created_at: string;
  job_label: string | null;
  cin7_number: string | null;
};

export type StoredRequirements = {
  installers: number;
  licensed_drivers: number;
  van_size: "small" | "crafter";
  van_count: number;
  stair_climber: boolean;
  install_days?: number;
  overridden: boolean;
  conflict: boolean;
  conflict_detail: string | null;
};

export type PulseNotification = {
  id: string;
  title: string;
  body: string;
  kind: string;
  channel: string;
  link: string | null;
  read_at: string | null;
  created_at: string;
};

export type PulseTask = {
  id: string;
  module_id: string;
  kind: string;
  title: string;
  body: string | null;
  status: string;
  priority: string;
  due_at: string | null;
  assignee_id: string | null;
  created_by: string | null;
  created_at: string;
  completed_at: string | null;
};
