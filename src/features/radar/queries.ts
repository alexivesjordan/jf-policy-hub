import "server-only";

import { DEFAULT_RADAR_SETTINGS } from "@/features/radar/defaults";
import { formatMoney, formatUkDate, formatWhen } from "@/features/radar/present";
import { createClient } from "@/lib/supabase/server";
import type { RadarScoringConfig, RadarStatus } from "@/features/radar/types";

export const RADAR_QUEUES: { id: RadarStatus; label: string }[] = [
  { id: "new", label: "New" },
  { id: "worth_pursuing", label: "Worth pursuing" },
  { id: "dismissed", label: "Dismissed" },
  { id: "pushed_to_hubspot", label: "Pushed to HubSpot" },
];

export type RadarCard = {
  id: string;
  title: string;
  buyer: string;
  value: string;
  deadline: string;
  award: string;
  decision: string;
  region: string;
  address: string;
  postcode: string;
  lpa: string;
  scope: string;
  facilities: string;
  contact: string;
  cpv: string;
  score: number;
  reasons: string[];
  status: RadarStatus;
  dismissReason: string | null;
  ownerId: string;
  sourceLabel: string;
  typeLabel: string;
  url: string;
  dealUrl: string | null;
  highlight: boolean;
};

export type RadarOwner = { id: string; name: string };

const UUID = /^[0-9a-f-]{36}$/i;

function sourceLabel(source: string) {
  if (source === "contracts-finder") return "Contracts Finder";
  if (source === "planit") return "PlanIt";
  return "Find a Tender";
}

const CARD_SELECT = "id, source, opportunity_type, title, buyer, value_amount, value_currency, deadline, expected_award_date, decision_status, decision_date, cpv_codes, region, site_address, postcode, lpa, scope_summary, facility_types, contact_name, contact_email, contact_phone, url, score, match_reasons, status, dismiss_reason, owner_id, hubspot_deal_url, updated_at";

function asStatus(value: string): RadarStatus {
  if (value === "worth_pursuing" || value === "dismissed" || value === "pushed_to_hubspot") return value;
  return "new";
}

export async function loadRadarQueue(input: { queue: RadarStatus; search: string; notice: string | null }) {
  const supabase = await createClient();
  const search = input.search.trim().toLowerCase();
  const [{ data, error }, counts, owners, updated] = await Promise.all([
    supabase
      .from("radar_opportunities")
      .select(CARD_SELECT)
      .eq("status", input.queue)
      .order("score", { ascending: false })
      .limit(200),
    Promise.all(RADAR_QUEUES.map(async (queue) => {
      const result = await supabase.from("radar_opportunities").select("id", { count: "exact", head: true }).eq("status", queue.id);
      return [queue.id, result.count ?? 0] as const;
    })),
    supabase.rpc("radar_owner_choices"),
    supabase.from("radar_opportunities").select("updated_at").order("updated_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (error) return { error: "The radar could not be loaded.", cards: [] as RadarCard[], counts: {} as Record<string, number>, owners: [] as RadarOwner[], updatedAt: null as string | null };
  const ownerRows = Array.isArray(owners.data)
    ? owners.data.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const row = item as { id?: string; full_name?: string };
        if (!row.id) return [];
        return [{ id: row.id, name: row.full_name || "Colleague" }];
      })
    : [];
  let cards = ((data ?? []) as Record<string, unknown>[]).map((row) => toCard(row, input.notice));
  if (search) {
    cards = cards.filter((card) => `${card.title} ${card.buyer} ${card.region} ${card.address} ${card.postcode}`.toLowerCase().includes(search));
  }
  if (input.notice && UUID.test(input.notice) && !cards.some((card) => card.id === input.notice)) {
    const singled = await supabase
      .from("radar_opportunities")
      .select(CARD_SELECT)
      .eq("id", input.notice)
      .maybeSingle();
    if (singled.data) cards = [toCard(singled.data as Record<string, unknown>, input.notice), ...cards];
  }
  const countMap = Object.fromEntries(counts);
  const stamp = updated.data && typeof updated.data === "object" ? (updated.data as { updated_at?: string }).updated_at ?? null : null;
  return { error: null, cards, counts: countMap, owners: ownerRows, updatedAt: stamp };
}

function textOf(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "Not published";
}

function toCard(row: Record<string, unknown>, notice: string | null): RadarCard {
  const codes = Array.isArray(row.cpv_codes) ? row.cpv_codes.filter((item): item is string => typeof item === "string") : [];
  const reasons = Array.isArray(row.match_reasons) ? row.match_reasons.filter((item): item is string => typeof item === "string") : [];
  const facilities = Array.isArray(row.facility_types) ? row.facility_types.filter((item): item is string => typeof item === "string") : [];
  const contact = [row.contact_name, row.contact_email, row.contact_phone].filter((item) => typeof item === "string" && item).join(" · ");
  const planning = row.opportunity_type === "planning";
  return {
    id: String(row.id),
    title: String(row.title ?? "Untitled notice"),
    buyer: String(row.buyer ?? "Not published"),
    value: formatMoney(row.value_amount, row.value_currency),
    deadline: formatUkDate(typeof row.deadline === "string" ? row.deadline : null),
    award: formatUkDate(typeof row.expected_award_date === "string" ? row.expected_award_date : null),
    decision: planning ? `${textOf(row.decision_status)}${typeof row.decision_date === "string" ? `, ${formatUkDate(row.decision_date)}` : ""}` : "Not published",
    region: textOf(row.region),
    address: textOf(row.site_address),
    postcode: textOf(row.postcode),
    lpa: textOf(row.lpa),
    scope: textOf(row.scope_summary),
    facilities: facilities.join(", ") || "Not published",
    contact: contact || "Not published",
    cpv: codes.slice(0, 6).join(" ") || "Not published",
    score: Number(row.score ?? 0),
    reasons,
    status: asStatus(String(row.status ?? "new")),
    dismissReason: typeof row.dismiss_reason === "string" ? row.dismiss_reason : null,
    ownerId: typeof row.owner_id === "string" ? row.owner_id : "",
    sourceLabel: sourceLabel(String(row.source ?? "")),
    typeLabel: planning ? "Planning" : "Tender",
    url: String(row.url ?? ""),
    dealUrl: typeof row.hubspot_deal_url === "string" ? row.hubspot_deal_url : null,
    highlight: notice != null && row.id === notice,
  };
}

export async function loadRadarSettings(): Promise<RadarScoringConfig> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("radar_settings").select("keywords, cpv_codes, value_bands, exclusions, hubspot_pipeline_id, hubspot_stage_id, hubspot_owner_id, hubspot_portal_id").eq("id", true).maybeSingle();
  if (error || !data) return DEFAULT_RADAR_SETTINGS;
  const row = data as {
    keywords?: string[];
    cpv_codes?: string[];
    value_bands?: { label: string; min: number | null; max: number | null; points: number }[];
    exclusions?: string[];
    hubspot_pipeline_id?: string | null;
    hubspot_stage_id?: string | null;
    hubspot_owner_id?: string | null;
    hubspot_portal_id?: string | null;
  };
  return {
    keywords: row.keywords ?? DEFAULT_RADAR_SETTINGS.keywords,
    cpvCodes: row.cpv_codes ?? DEFAULT_RADAR_SETTINGS.cpvCodes,
    valueBands: Array.isArray(row.value_bands) ? row.value_bands : DEFAULT_RADAR_SETTINGS.valueBands,
    exclusions: row.exclusions ?? DEFAULT_RADAR_SETTINGS.exclusions,
    hubspotPipelineId: row.hubspot_pipeline_id ?? "",
    hubspotStageId: row.hubspot_stage_id ?? "",
    hubspotOwnerId: row.hubspot_owner_id ?? "",
    hubspotPortalId: row.hubspot_portal_id ?? "",
  };
}

export { formatWhen };
