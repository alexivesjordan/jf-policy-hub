"use server";

import { revalidatePath } from "next/cache";
import { canEditRadar, requireRadarUser } from "@/features/radar/access";
import { buildHubSpotDeal, createHubSpotDeal, hubspotConnected, hubspotDealUrl, hubSpotProperties } from "@/features/radar/hubspot";
import { parseRadarSettings } from "@/features/radar/settings";
import { messageFromError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";

export type RadarActionState = { ok: boolean; message: string } | null;

const UUID = /^[0-9a-f-]{36}$/i;

function fail(message: string): RadarActionState {
  return { ok: false, message };
}

async function editor() {
  const profile = await requireRadarUser();
  if (!canEditRadar(profile)) return { profile, denied: "You can view the radar. Editing needs sales edit." as const };
  return { profile, denied: null };
}

export async function reviewOpportunity(_state: RadarActionState, formData: FormData): Promise<RadarActionState> {
  const gate = await editor();
  if (gate.denied) return fail(gate.denied);
  const id = String(formData.get("id") ?? "");
  const intent = String(formData.get("intent") ?? "");
  if (!UUID.test(id)) return fail("That opportunity is not available.");
  const supabase = await createClient();
  const loaded = await supabase
    .from("radar_opportunities")
    .select("id, title, buyer, value_amount, url, status, scope_summary, expected_award_date, decision_date, deadline")
    .eq("id", id)
    .maybeSingle();
  if (loaded.error || !loaded.data) return fail("That opportunity is not available.");
  const row = loaded.data as {
    id: string;
    title: string;
    buyer: string;
    value_amount: number | string | null;
    url: string;
    status: string;
    scope_summary: string | null;
    expected_award_date: string | null;
    decision_date: string | null;
    deadline: string | null;
  };
  const ownerRaw = String(formData.get("owner_id") ?? "");
  const ownerId = ownerRaw ? ownerRaw : null;
  if (ownerRaw && !UUID.test(ownerRaw)) return fail("Choose a sales colleague.");
  const patch: { owner_id?: string | null; status?: string; dismiss_reason?: string | null; hubspot_deal_id?: string; hubspot_deal_url?: string | null } = {};
  if (formData.has("owner_id")) patch.owner_id = ownerId;
  if (intent === "assign") {
    if (!("owner_id" in patch)) return fail("Choose a sales colleague.");
  } else if (row.status === "pushed_to_hubspot") {
    return fail("A pushed opportunity stays pushed. HubSpot owns the deal.");
  } else if (intent === "pursue") {
    patch.status = "worth_pursuing";
  } else if (intent === "reset") {
    patch.status = "new";
  } else if (intent === "dismiss") {
    const reason = String(formData.get("reason") ?? "").trim();
    if (reason.length < 3 || reason.length > 500) return fail("Add a reason.");
    patch.status = "dismissed";
    patch.dismiss_reason = reason;
  } else if (intent === "push") {
    const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN?.trim() ?? "";
    if (!hubspotConnected(token)) return fail("HubSpot isn't connected");
    const settings = await supabase.from("radar_settings").select("hubspot_pipeline_id, hubspot_stage_id, hubspot_owner_id, hubspot_portal_id").eq("id", true).maybeSingle();
    if (settings.error || !settings.data) return fail("Radar settings are not available.");
    const config = settings.data as { hubspot_pipeline_id?: string | null; hubspot_stage_id?: string | null; hubspot_owner_id?: string | null; hubspot_portal_id?: string | null };
    const amount = row.value_amount == null || row.value_amount === "" ? null : Number(row.value_amount);
    const closeDate = (row.decision_date ?? row.expected_award_date ?? row.deadline)?.slice(0, 10) ?? null;
    const draft = buildHubSpotDeal({
      title: row.title,
      buyer: row.buyer,
      valueAmount: amount != null && Number.isFinite(amount) ? amount : null,
      closeDate: closeDate && /^\d{4}-\d{2}-\d{2}$/.test(closeDate) ? closeDate : null,
      scopeSummary: row.scope_summary ?? "",
      url: row.url,
      pipelineId: config.hubspot_pipeline_id ?? "",
      stageId: config.hubspot_stage_id ?? "",
      ownerId: config.hubspot_owner_id ?? "",
    });
    let dealId = "";
    try {
      dealId = (await createHubSpotDeal(draft, { token })).id;
    } catch (error) {
      await supabase.from("radar_hubspot_intents").insert({
        opportunity_id: row.id,
        requested_by: gate.profile.id,
        status: "failed",
        payload: hubSpotProperties(draft),
        error_text: error instanceof Error ? error.message.slice(0, 300) : "HubSpot did not create the deal.",
      });
      return fail(error instanceof Error ? error.message : "HubSpot did not create the deal.");
    }
    const dealUrl = hubspotDealUrl(config.hubspot_portal_id ?? "", dealId);
    const logged = await supabase.from("radar_hubspot_intents").insert({
      opportunity_id: row.id,
      requested_by: gate.profile.id,
      status: "succeeded",
      payload: hubSpotProperties(draft),
      hubspot_deal_id: dealId,
    });
    if (logged.error) return fail(messageFromError(logged.error, "The deal was created but the push log failed."));
    patch.status = "pushed_to_hubspot";
    patch.hubspot_deal_id = dealId;
    patch.hubspot_deal_url = dealUrl;
  } else {
    return fail("That action is not available.");
  }
  const saved = await supabase.from("radar_opportunities").update(patch).eq("id", id);
  if (saved.error) return fail(messageFromError(saved.error, "Could not update the opportunity."));
  if (patch.status === "pushed_to_hubspot") {
    await supabase.from("radar_reminders").delete().eq("opportunity_id", id);
  }
  revalidatePath("/sales/radar");
  return { ok: true, message: "Updated." };
}

export async function saveRadarSettings(_state: RadarActionState, formData: FormData): Promise<RadarActionState> {
  const profile = await requireRadarUser();
  const supabase = await createClient();
  const admin = await supabase.rpc("workspace_is_admin");
  if (admin.error || admin.data !== true) return fail("Radar settings are limited to admins.");
  const parsed = parseRadarSettings({
    keywords: String(formData.get("keywords") ?? ""),
    cpvCodes: String(formData.get("cpv_codes") ?? ""),
    bands: [0, 1, 2, 3].map((index) => ({
      label: String(formData.get(`band_label_${index}`) ?? ""),
      min: String(formData.get(`band_min_${index}`) ?? ""),
      max: String(formData.get(`band_max_${index}`) ?? ""),
      points: String(formData.get(`band_points_${index}`) ?? ""),
    })),
    exclusions: String(formData.get("exclusions") ?? ""),
    hubspotPipelineId: String(formData.get("hubspot_pipeline_id") ?? ""),
    hubspotStageId: String(formData.get("hubspot_stage_id") ?? ""),
    hubspotOwnerId: String(formData.get("hubspot_owner_id") ?? ""),
    hubspotPortalId: String(formData.get("hubspot_portal_id") ?? ""),
  });
  if (!parsed.ok) return parsed;
  const saved = await supabase
    .from("radar_settings")
    .update({
      keywords: parsed.config.keywords,
      cpv_codes: parsed.config.cpvCodes,
      value_bands: parsed.config.valueBands,
      exclusions: parsed.config.exclusions,
      hubspot_pipeline_id: parsed.config.hubspotPipelineId || null,
      hubspot_stage_id: parsed.config.hubspotStageId || null,
      hubspot_owner_id: parsed.config.hubspotOwnerId || null,
      hubspot_portal_id: parsed.config.hubspotPortalId || null,
      updated_by: profile.id,
    })
    .eq("id", true);
  if (saved.error) return fail(messageFromError(saved.error, "Could not save radar settings."));
  revalidatePath("/sales/radar");
  revalidatePath("/sales/radar/settings");
  return { ok: true, message: "Saved." };
}
