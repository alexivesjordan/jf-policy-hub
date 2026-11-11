import type { SupabaseClient } from "@supabase/supabase-js";

const USER_ID = "00000000-0000-4000-8000-000000000001";
let fixtureServiceQuote: { id: string; prices: unknown } | null = null;
const JOB_BOOKED = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const JOB_PRICED = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const JOB_SITE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";

const profile = {
  id: USER_ID,
  email: "alex.ives@jordanfitness.com",
  first_name: "Alex",
  last_name: "Ives",
  full_name: "Alex Ives",
  role: "admin",
  is_active: true,
  access_granted: true,
  last_sign_in_at: "2026-11-10T09:00:00Z",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-11-01T00:00:00Z",
};

const categories = [
  { id: "cat-hr", name: "People", slug: "people", auto_apply_allowed: false },
  { id: "cat-health", name: "Health and safety", slug: "health-and-safety", auto_apply_allowed: true },
];

const policies = [
  {
    id: "pol-leave",
    title: "Annual leave",
    category_id: "cat-hr",
    owner_id: USER_ID,
    status: "active",
    review_date: "2027-03-01",
    current_content: "Annual leave is booked with your manager.",
    source_file_path: null,
    source_file_name: null,
    created_by: USER_ID,
    created_at: "2026-06-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    category: categories[0],
    owner: { id: USER_ID, full_name: "Alex Ives", email: profile.email },
  },
  {
    id: "pol-site",
    title: "Site safety",
    category_id: "cat-health",
    owner_id: USER_ID,
    status: "active",
    review_date: "2026-12-01",
    current_content: "Hard hats on every install.",
    source_file_path: null,
    source_file_name: null,
    created_by: USER_ID,
    created_at: "2026-04-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    category: categories[1],
    owner: { id: USER_ID, full_name: "Alex Ives", email: profile.email },
  },
  {
    id: "pol-hybrid",
    title: "Hybrid working",
    category_id: "cat-hr",
    owner_id: null,
    status: "draft",
    review_date: null,
    current_content: "",
    source_file_path: null,
    source_file_name: null,
    created_by: USER_ID,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
    category: categories[0],
    owner: null,
  },
];

const jobs = [
  job("aaaaaaaaaaa1", JOB_BOOKED, "booked", "Booked", "Northshore Gym", "Leeds", "LS1 4DY", "2026-11-17", "2026-11-19"),
  job("aaaaaaaaaaa2", JOB_PRICED, "priced", "Priced", "Harbour Fitness", "Brighton", "BN1 1AA", "2026-11-24", "2026-11-26"),
  job("aaaaaaaaaaa3", JOB_SITE, "on_site", "On site", "City Strength", "Manchester", "M1 2WD", "2026-11-10", "2026-11-12"),
];

function job(
  suffix: string,
  id: string,
  status: string,
  statusLabel: string,
  customer: string,
  city: string,
  postcode: string,
  start: string,
  end: string,
) {
  return {
    id,
    status,
    status_label: statusLabel,
    job_type: "install",
    cin7_number: `FIXTURE-${suffix.slice(-4)}`,
    cin7_order_number: `FIXTURE-${suffix.slice(-4)}`,
    cin7_quote_number: null,
    fixture: true,
    customer_name: customer,
    customer_segment: "independent",
    customer_type: "gym",
    postcode,
    city,
    big_install: false,
    hold_reason: null,
    requested_date: start,
    requested_end: end,
    booked_date: status === "priced" ? null : start,
    created_at: "2026-11-01T00:00:00Z",
    delivered_by: "jordan",
    big_install_triggers: [],
    arrival_window: null,
    hold_review_date: null,
    lost_reason: null,
    customer: { id: `cust-${suffix}`, name: customer, segment: "independent", customer_type: "gym", cin7_id: suffix },
    site: { id: `site-${suffix}`, name: customer, address_line1: "1 High Street", city, postcode },
    quote_versions: [],
  };
}

const effortRows = [
  {
    sku: "JF-BENCH-01",
    product_name: "Adjustable bench",
    cin7_category: "Benches",
    cin7_uom: "Each",
    needs_assembly: true,
    crew: 2,
    build_minutes: 45,
    effort_unit: "each",
    build_location: "site",
    status: "confirmed",
    notes: null,
  },
  {
    sku: "JF-SLED-10",
    product_name: "Sled track 10m",
    cin7_category: "Flooring",
    cin7_uom: "Each",
    needs_assembly: true,
    crew: 2,
    build_minutes: 180,
    effort_unit: "each",
    build_location: "site",
    status: "suggested",
    notes: null,
    suggestion_rule: "sled-track",
  },
  {
    sku: "JF-PIN-04",
    product_name: "Pin-loaded lat pulldown",
    cin7_category: "Strength",
    cin7_uom: "Each",
    needs_assembly: true,
    crew: 2,
    build_minutes: null,
    effort_unit: "each",
    build_location: "hq",
    hq_build_minutes: 90,
    hq_build_crew: 2,
    site_position_minutes: 20,
    status: "suggested",
    notes: "Build at HQ",
    suggestion_rule: "pin-loaded",
  },
];

const resources = [
  { id: "res-lee", name: "Lee", resource_type: "installer", notes: null, has_licence: true, insured: true },
  { id: "res-sam", name: "Sam", resource_type: "installer", notes: null, has_licence: true, insured: true },
  { id: "res-van", name: "Small van 1", resource_type: "van", notes: null, has_licence: false, insured: true },
];

function weekMonday() {
  const now = new Date();
  const day = now.getUTCDay() || 7;
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day + 1));
  return monday.toISOString().slice(0, 10);
}

function tables(): Record<string, Record<string, unknown>[]> {
  return {
    profiles: [profile],
    categories,
    policies,
    policy_versions: [],
    amendments: [],
    notifications: [],
    audit_log: [],
    module_access: [
      { module_id: "people", enabled: true, profile_id: USER_ID },
      { module_id: "operations", enabled: true, profile_id: USER_ID },
      { module_id: "sales", enabled: true, profile_id: USER_ID },
    ],
  };
}

function rpcData(fn: string, args?: Record<string, unknown>) {
  if (fn === "workspace_my_access") {
    if (process.env.PULSE_FIXTURE_ROLE === "rep") {
      return { role: "member", mode: "follow", people: "none", service: "none", supply: "none", operations: "none", sales: "edit", finance: "none" };
    }
    return { role: "owner", mode: "follow", people: "edit", service: "edit", supply: "edit", operations: "edit", sales: "edit", finance: "edit" };
  }
  if (fn === "workspace_directory") {
    return [
      {
        id: USER_ID,
        email: profile.email,
        first_name: "Alex",
        last_name: "Ives",
        full_name: profile.full_name,
        workspace_role: "owner",
        access_mode: "follow",
        is_active: true,
        teams: ["Management"],
        effective: { people: "edit", service: "edit", supply: "edit", operations: "edit", sales: "edit", finance: "edit" },
      },
      {
        id: "00000000-0000-4000-8000-000000000002",
        email: "sam.cole@jordanfitness.com",
        first_name: "Sam",
        last_name: "Cole",
        full_name: "Sam Cole",
        workspace_role: "member",
        access_mode: "follow",
        is_active: true,
        teams: ["Installs"],
        effective: { people: "view", operations: "edit", sales: "none", service: "none", supply: "none", finance: "none" },
      },
      {
        id: "00000000-0000-4000-8000-000000000003",
        email: "riley.hart@jordanfitness.com",
        first_name: "Riley",
        last_name: "Hart",
        full_name: "Riley Hart",
        workspace_role: "member",
        access_mode: "custom",
        is_active: true,
        teams: ["Sales"],
        effective: { people: "none", service: "view", supply: "none", operations: "none", sales: "edit", finance: "none" },
      },
    ];
  }
  if (fn === "workspace_teams") {
    return [
      { id: "team-sales", name: "Sales", members: 4 },
      { id: "team-installs", name: "Installs", members: 6 },
      { id: "team-aftersales", name: "Aftersales", members: 2 },
      { id: "team-operations", name: "Operations", members: 3 },
      { id: "team-office", name: "Office", members: 3 },
      { id: "team-management", name: "Management", members: 2 },
    ];
  }
  if (fn === "service_get_ingest") return null;
  if (fn === "service_put_ingest") return "ingest-1";
  if (fn === "service_current_rates") {
    return {
      id: "rate-1",
      label: "2026-11-11-standalone-v1",
      callout_gbp: 99,
      per_machine_gbp: 59,
      uplift: 1.08,
      twice_yearly_factor: 0.92,
      cardio_rate: 0.05,
      strength_rate: 0.03,
      rack_rate: 0.02,
      extension_factor: 1.3,
      per_site_gbp: 150,
      bundle_incentive_gbp: 195,
      portfolio_factor: 0.9,
    };
  }
  if (fn === "service_list_rules") {
    return [{ match_kind: "description_contains", match_value: "bench", category: "adjustable_bench", priority: 10, note: "Benches" }];
  }
  if (fn === "service_can_see_flags") return process.env.PULSE_FIXTURE_ROLE !== "rep";
  if (fn === "service_save_quote") {
    fixtureServiceQuote = { id: "svc-quote-1", prices: args?.p_prices ?? null };
    return fixtureServiceQuote.id;
  }
  if (fn === "service_read_quote") return fixtureServiceQuote;
  if (fn === "service_set_proposal_path" || fn === "save_person_name" || fn === "service_save_rates" || fn === "service_upsert_rule") return true;
  if (fn === "orbit_office_context") {
    if (process.env.PULSE_FIXTURE_ROLE === "rep") return { has_module: true, ops_role: "sales", is_owner: false, operations: "none", sales: "edit" };
    return { has_module: true, ops_role: "admin_owner", is_owner: true, operations: "edit", sales: "edit" };
  }
  if (fn === "orbit_list_jobs") return jobs;
  if (fn === "orbit_get_job") return jobs.find((row) => row.id === args?.p_job_id) ?? null;
  if (fn === "orbit_list_notifications") return [];
  if (fn === "orbit_list_tasks") return [];
  if (fn === "orbit_list_gate_overrides") return [];
  if (fn === "orbit_read_settings") {
    return {
      settings: null,
      pricing_settings: {
        version: 3,
        markup_independent: 1.35,
        markup_franchisee: 1.25,
        markup_trade: 1.2,
        markup_big_corporate: 1.15,
        min_job_charge: 450,
        margin_floor_pct: 0.18,
        custom_deposit_fraction: 0.5,
        large_order_threshold: 25000,
        variation_rounding_hours: 0.5,
        sled_track_width_m: 1.2,
        sled_base_minutes: 180,
        sled_base_length_m: 10,
        sled_extra_minutes_per_m: 6,
        change_reason: null,
        created_at: "2026-10-01T00:00:00Z",
      },
    };
  }
  if (fn === "orbit_read_terms") {
    return {
      id: "terms-1",
      version_label: "2026.1",
      is_live: true,
      charges_grid: { lines: [{ label: "Installer hour", rate: 45, unit: "hour" }] },
      cancellation_schedule: { rows: [{ notice: "More than 7 days", charge_pct: 0 }, { notice: "Under 48 hours", charge_pct: 100, plus_third_party_costs: true }] },
      created_at: "2026-01-01T00:00:00Z",
    };
  }
  if (fn === "orbit_cin7_category_defaults") {
    return [{ category: "Benches", needs_assembly: true, crew: 2, build_minutes: 45, effort_unit: "each", build_location: "site", status: "confirmed", notes: "" }];
  }
  if (fn === "orbit_categories_without_default") return [];
  if (fn === "orbit_list_sku_effort") {
    const search = String(args?.p_search ?? "").toLowerCase();
    const category = String(args?.p_category ?? "");
    const status = String(args?.p_status ?? "");
    const rows = effortRows.filter((row) => {
      if (search && !`${row.sku} ${row.product_name}`.toLowerCase().includes(search)) return false;
      if (category && row.cin7_category !== category) return false;
      if (status && row.status !== status) return false;
      return true;
    });
    return { review_count: 2, name_rule_count: 2, total: rows.length, categories: ["Benches", "Flooring", "Strength"], rows };
  }
  if (fn === "orbit_calendar") {
    const monday = weekMonday();
    return {
      resources,
      reservations: [{ resource_id: "res-lee", job_id: JOB_SITE, day: monday, kind: "pencil", cin7_number: "FIXTURE-aaa3" }],
      unavailability: [],
    };
  }
  if (fn === "orbit_job_requirements") {
    return { installers: 2, licensed_drivers: 1, van_size: "small", van_count: 1, stair_climber: false, install_days: 2 };
  }
  if (fn === "orbit_pricing_snapshot") {
    return {
      markup_independent: 0.4,
      markup_franchisee: 0.4,
      markup_trade: 0.5,
      markup_big_corporate: 0.8,
      min_job_charge: null,
      margin_floor_pct: null,
      large_order_threshold: 50000,
      variation_rounding_hours: 0.5,
      sled_track_width_m: null,
      sled_base_minutes: 180,
      sled_base_length_m: 10,
      sled_extra_minutes_per_m: 6,
    };
  }
  if (fn === "orbit_sku_effort_for_pricing") return [];
  if (fn === "orbit_record_fixture_quote" || fn === "orbit_record_cin7_sale") return { job_id: JOB_PRICED };
  if (fn === "orbit_save_job_requirements" || fn === "orbit_remember_segment") return true;
  return null;
}

type Filter = { kind: "eq" | "neq" | "lte" | "null" | "notnull"; column: string; value?: unknown };

class FixtureQuery implements PromiseLike<{ data: unknown; error: null; count: number | null }> {
  private filters: Filter[] = [];
  private asSingle = false;
  private head = false;

  constructor(private table: string) {}

  select(_columns?: string, options?: { head?: boolean; count?: string }) {
    this.head = Boolean(options?.head);
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push({ kind: "eq", column, value });
    return this;
  }

  neq(column: string, value: unknown) {
    this.filters.push({ kind: "neq", column, value });
    return this;
  }

  lte(column: string, value: unknown) {
    this.filters.push({ kind: "lte", column, value });
    return this;
  }

  is(column: string, value: unknown) {
    this.filters.push({ kind: value == null ? "null" : "eq", column, value });
    return this;
  }

  not(column: string, _operator: string, value: unknown) {
    this.filters.push({ kind: value == null ? "notnull" : "neq", column, value });
    return this;
  }

  or() {
    return this;
  }

  order() {
    return this;
  }

  limit() {
    return this;
  }

  in() {
    return this;
  }

  maybeSingle() {
    this.asSingle = true;
    return this;
  }

  single() {
    this.asSingle = true;
    return this;
  }

  then<TResult1 = { data: unknown; error: null; count: number | null }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: null; count: number | null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.result()).then(onfulfilled, onrejected);
  }

  private result() {
    let rows = tables()[this.table] ?? [];
    for (const filter of this.filters) {
      rows = rows.filter((row) => {
        const value = row[filter.column];
        if (filter.kind === "eq") return value === filter.value;
        if (filter.kind === "neq") return value !== filter.value;
        if (filter.kind === "null") return value == null;
        if (filter.kind === "notnull") return value != null;
        if (filter.kind === "lte") return String(value ?? "") <= String(filter.value ?? "");
        return true;
      });
    }
    if (this.head) return { data: null, error: null, count: rows.length };
    if (this.asSingle) return { data: rows[0] ?? null, error: null, count: null };
    return { data: rows, error: null, count: null };
  }
}

export function createFixtureClient() {
  const client = {
    auth: {
      async getUser() {
        return { data: { user: { id: USER_ID, email: profile.email } }, error: null };
      },
    },
    from(table: string) {
      return new FixtureQuery(table);
    },
    async rpc(fn: string, args?: Record<string, unknown>) {
      return { data: rpcData(fn, args), error: null };
    },
    storage: {
      from() {
        return {
          async upload() {
            return { data: { path: "proposal.docx" }, error: null };
          },
          async createSignedUrl(path: string) {
            return { data: { signedUrl: `https://jqdhkrlopmgbwbjebgxy.supabase.co/storage/v1/object/sign/service-proposals/${path}?token=fixture` }, error: null };
          },
        };
      },
    },
  };
  return client as unknown as SupabaseClient;
}
