import type { SupabaseClient } from "@supabase/supabase-js";
import { fixtureSubcontractorRpc } from "@/lib/subcontractors/fixture-board";

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
  const subcontractor = fixtureSubcontractorRpc(fn, args);
  if (subcontractor.handled) return subcontractor.data;
  if (fn === "workspace_is_admin") return process.env.PULSE_FIXTURE_ROLE !== "rep" && process.env.PULSE_FIXTURE_ROLE !== "lead";
  if (fn === "workspace_can") {
    const moduleName = String(args?.p_module ?? "");
    if (process.env.PULSE_FIXTURE_ROLE === "rep") return moduleName === "sales";
    if (process.env.PULSE_FIXTURE_ROLE === "lead") return moduleName === "operations" || moduleName === "sales";
    return true;
  }
  if (fn === "workspace_my_access") {
    if (process.env.PULSE_FIXTURE_ROLE === "rep") {
      return { role: "member", mode: "follow", people: "none", service: "none", supply: "none", operations: "none", sales: "edit", finance: "none" };
    }
    if (process.env.PULSE_FIXTURE_ROLE === "lead") {
      return { role: "member", mode: "follow", people: "none", service: "none", supply: "none", operations: "edit", sales: "view", finance: "none" };
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
    if (process.env.PULSE_FIXTURE_ROLE === "lead") return { has_module: true, ops_role: "install_lead", is_owner: false, operations: "edit", sales: "view" };
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
        markup_independent: 0.4,
        markup_franchisee: 0.4,
        markup_trade: 0.5,
        markup_big_corporate: 0.8,
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
  if (fn === "install_save_quote") return "11111111-1111-4111-8111-111111111111";
  if (fn === "install_available_starts") {
    const from = String(args?.p_from ?? "2026-11-16").slice(0, 10);
    const to = String(args?.p_to ?? isoPlus(from, 42)).slice(0, 10);
    const dates: string[] = [];
    let cursor = from;
    let guard = 0;
    while (cursor <= to && guard < 130) {
      const day = new Date(`${cursor}T12:00:00Z`).getUTCDay();
      if (day !== 0 && day !== 6) dates.push(cursor);
      cursor = isoPlus(cursor, 1);
      guard += 1;
    }
    return dates;
  }
  if (fn === "install_book") {
    const start = String(args?.p_start ?? "2026-11-16").slice(0, 10);
    return fixtureInstall(start, String(args?.p_warranty ?? "none"), true);
  }
  if (fn === "install_calendar") {
    const spanning = fixtureInstall("2026-11-13", "annual", true, "booked", "awaiting_access");
    spanning.endOn = "2026-11-17";
    const rows = [
      spanning,
      fixtureInstall("2026-11-23", "none", false, "booked", "booked"),
      fixtureInstall("2026-11-18", "none", true, "completed", "ready"),
      fixtureInstall("2026-10-20", "none", false, "completed", "completed"),
    ];
    return args?.p_mine ? rows.filter((row) => row.bookingRepId === USER_ID) : rows;
  }
  if (fn === "install_access_preview") {
    const hash = String(args?.p_token_hash ?? "");
    const submitted = hash === "910e32b68f763654876df78b27a8bebe721aa6520b9784264eafe32397a6e0f0";
    return {
      install_id: submitted ? "11111111-1111-4111-8111-1111111111c3" : "11111111-1111-4111-8111-1111111111a1",
      customer_name: "Example Sports Centre",
      site_address: "1 Harbour Road",
      submitted,
      media_count: submitted ? 1 : 0,
      accepted_by_name: submitted ? "Alex Example" : null,
      answers: submitted ? { groundFloor: true, floorNumber: null, hasLift: false, dropZone: "Front car park" } : null,
      terms: {
        id: "terms-1",
        version_label: "v1-original",
        lines: [
          { label: "Additional installer time, within agreed hours", rate: 30, unit: "per installer per hour" },
          { label: "Materials and consumables", basis: "cost_plus_25" },
          { label: "Equipment movement beyond the agreed floor plan", basis: "additional_installer_time" },
          { label: "Parking, permits, congestion fees (clause 8)", basis: "at_cost" },
        ],
      },
      media: submitted
        ? [{ id: "media-1", kind: "photo", fileName: "door.jpg", mime: "image/jpeg", bucket: "access-media", path: "ops/11111111-1111-4111-8111-1111111111c3/door.jpg" }]
        : [],
    };
  }
  if (fn === "orbit_register_file") return "22222222-2222-4222-8222-222222222222";
  if (fn === "install_save_access") return { ok: true };
  if (fn === "install_set_contact_email" || fn === "install_revoke_access_links" || fn === "install_mark_access_sent") return true;
  if (fn === "install_read") {
    const id = String(args?.p_id ?? "");
    const row = id.endsWith("b2")
      ? fixtureInstall("2026-11-23", "none", false)
      : id.endsWith("c3")
        ? fixtureInstall("2026-11-18", "none", true, "completed", "ready")
        : id.endsWith("d4")
          ? fixtureInstall("2026-10-20", "none", false, "completed", "completed")
          : fixtureInstall("2026-11-16", "annual", true, "booked", "awaiting_access");
    if (process.env.PULSE_FIXTURE_ROLE === "rep") {
      const source = row as Record<string, unknown>;
      const sales: Record<string, unknown> = {};
      for (const key of ["id", "orderNumber", "goodsNet", "installPrice", "warrantyOption", "warrantyPrice", "startOn", "endOn", "customerName", "contactName", "contactEmail", "contactPhone", "siteAddress", "status", "stage", "bookingRepId", "bookingRepName", "proposalPath", "serviceQuoteId"]) {
        sales[key] = source[key];
      }
      return sales;
    }
    return row;
  }
  if (fn === "install_move") {
    const start = String(args?.p_start ?? "2026-11-18").slice(0, 10);
    return fixtureInstall(start, "annual", true);
  }
  if (fn === "install_set_status") return fixtureInstall("2026-11-16", "annual", true, String(args?.p_status ?? "booked"));
  return null;
}

function isoPlus(iso: string, days: number) {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function fixtureInstall(start: string, warranty: string, mine: boolean, status = "booked", stage = "booked") {
  const end = isoPlus(start, 2);
  return {
    id: stage === "ready" ? "11111111-1111-4111-8111-1111111111c3" : stage === "completed" ? "11111111-1111-4111-8111-1111111111d4" : mine ? "11111111-1111-4111-8111-1111111111a1" : "11111111-1111-4111-8111-1111111111b2",
    orderNumber: stage === "ready" ? "SO-1008" : stage === "completed" ? "SO-1009" : mine ? "EXAMPLE-00490" : "SO-1002",
    customerName: stage === "ready" ? "Harbour Gym" : stage === "completed" ? "Northside Fitness" : mine ? "Example Sports Centre" : "Northside Fitness",
    goodsNet: 49066.53,
    installPrice: 4743.62,
    warrantyOption: warranty === "none" ? null : warranty,
    warrantyPrice: warranty === "annual" ? 1895 : null,
    startOn: start,
    endOn: end,
    contactName: "Alex Example",
    contactEmail: stage === "booked" && !mine ? null : "alex.example@example.com",
    contactPhone: "01603 000000",
    siteAddress: "Example Road, Exampletown IP1 9ZZ",
    status,
    stage,
    needsCustomerEmail: stage === "booked" && !mine,
    access: {
      sentAt: stage === "booked" ? null : "2026-11-01T09:00:00Z",
      submittedAt: stage === "ready" || stage === "completed" ? "2026-11-02T09:00:00Z" : null,
      mediaCount: stage === "ready" || stage === "completed" ? 1 : 0,
      answers: stage === "ready" || stage === "completed" ? { groundFloor: true, dropZone: "Front car park" } : null,
      media: stage === "ready" || stage === "completed"
        ? [{ id: "media-1", mime: "image/svg+xml", kind: "photo", url: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Crect width='120' height='120' fill='%23146336'/%3E%3C/svg%3E" }]
        : [],
    },
    bookingRepId: mine ? USER_ID : "00000000-0000-4000-8000-000000000003",
    bookingRepName: mine ? "Alex Ives" : "Riley Hart",
    proposalPath: mine ? "ops/proposal.docx" : null,
    serviceQuoteId: mine ? "svc-quote-1" : null,
    flags: { install: ["Needs review: HIDDEN-RACK"], service: [] },
    hqBuild: { personHours: 6, lines: [{ productName: "HIDDEN-PRODUCT", qty: 2, minutes: 40, crew: 2 }] },
    siteInstall: { days: 2, nights: 0, onSiteHours: 8 },
    crew: 2,
    vans: { size: "small", count: 1 },
    resources: [{ id: "res-lee", name: "Lee" }],
    lines: [{ sku: "HIDDEN-SKU", description: "HIDDEN-PRODUCT", qty: 2, category: "cardio", lineNet: 1000 }],
    cin7SaleId: "sale-1",
    cin7CustomerId: "customer-1",
  };
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

function fixtureAccessMime(path: string) {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "mp4") return "video/mp4";
  if (ext === "mov") return "video/quicktime";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "heic") return "image/heic";
  if (ext === "pdf") return "application/pdf";
  return "image/jpeg";
}

function fixtureAccessBytes(path: string) {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return Uint8Array.from(Buffer.from("%PDF-1.4"));
  if (ext === "png") return Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (ext === "webp") return Uint8Array.from([...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WEBP")]);
  if (ext === "mp4" || ext === "mov" || ext === "heic") {
    const bytes = new Uint8Array(16);
    bytes.set(Buffer.from("ftyp"), 4);
    bytes.set(Buffer.from(ext === "mov" ? "qt  " : ext === "heic" ? "heic" : "isom"), 8);
    return bytes;
  }
  return Buffer.from("/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAMAAwDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABAb/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCZACpZ/9k=", "base64");
}

function fixtureAccessBytesUrl(path: string) {
  return `data:${fixtureAccessMime(path)};base64,${Buffer.from(fixtureAccessBytes(path)).toString("base64")}`;
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
      try {
        return { data: rpcData(fn, args), error: null };
      } catch (error) {
        return { data: null, error: { message: error instanceof Error ? error.message : "app: Could not do that." } };
      }
    },
    storage: {
      from(bucket: string) {
        return {
          async upload() {
            return { data: { path: "proposal.docx" }, error: null };
          },
          async createSignedUrl(path: string) {
            if (bucket === "access-media" || bucket === "insurance") return { data: { signedUrl: fixtureAccessBytesUrl(path) }, error: null };
            return { data: { signedUrl: `https://jqdhkrlopmgbwbjebgxy.supabase.co/storage/v1/object/sign/service-proposals/${path}?token=fixture` }, error: null };
          },
          async createSignedUploadUrl(path: string) {
            return { data: { path, token: "fixture", signedUrl: "/api/access/media/fixture-upload" }, error: null };
          },
          async info(path: string) {
            return { data: { size: 128, contentType: fixtureAccessMime(path) }, error: null };
          },
          async remove() {
            return { data: [], error: null };
          },
        };
      },
    },
  };
  return client as unknown as SupabaseClient;
}
