"use server";

import { revalidatePath } from "next/cache";
import { canEditRadar, requireRadarUser } from "@/features/radar/access";
import { buildHubSpotIntent } from "@/features/radar/hubspot";
import { parseRadarSettings } from "@/features/radar/settings";
import { messageFromError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import type { RadarSource } from "@/features/radar/types";

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
    .select("id, source, notice_id, title, buyer, value_amount, value_currency, url, status")
    .eq("id", id)
    .maybeSingle();
  if (loaded.error || !loaded.data) return fail("That opportunity is not available.");
  const row = loaded.data as {
    id: string;
    source: RadarSource;
    notice_id: string;
    title: string;
    buyer: string;
    value_amount: number | string | null;
    value_currency: string | null;
    url: string;
    status: string;
  };
  const ownerRaw = String(formData.get("owner_id") ?? "");
  const ownerId = ownerRaw ? ownerRaw : null;
  if (ownerRaw && !UUID.test(ownerRaw)) return fail("Choose a sales colleague.");
  const patch: { owner_id?: string | null; status?: string; dismiss_reason?: string | null } = {};
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
    const amount = row.value_amount == null || row.value_amount === "" ? null : Number(row.value_amount);
    const recorded = buildHubSpotIntent({
      id: row.id,
      source: row.source,
      noticeId: row.notice_id,
      title: row.title,
      buyer: row.buyer,
      valueAmount: amount != null && Number.isFinite(amount) ? amount : null,
      valueCurrency: row.value_currency,
      url: row.url,
    });
    const intentRow = await supabase.from("radar_hubspot_intents").upsert(
      {
        opportunity_id: row.id,
        requested_by: gate.profile.id,
        status: "recorded",
        payload: recorded,
      },
      { onConflict: "opportunity_id", ignoreDuplicates: true },
    );
    if (intentRow.error) return fail(messageFromError(intentRow.error, "Could not record the HubSpot request."));
    patch.status = "pushed_to_hubspot";
  } else {
    return fail("That action is not available.");
  }
  const saved = await supabase.from("radar_opportunities").update(patch).eq("id", id);
  if (saved.error) return fail(messageFromError(saved.error, "Could not update the opportunity."));
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
  });
  if (!parsed.ok) return parsed;
  const saved = await supabase
    .from("radar_settings")
    .update({
      keywords: parsed.config.keywords,
      cpv_codes: parsed.config.cpvCodes,
      value_bands: parsed.config.valueBands,
      updated_by: profile.id,
    })
    .eq("id", true);
  if (saved.error) return fail(messageFromError(saved.error, "Could not save radar settings."));
  revalidatePath("/sales/radar");
  revalidatePath("/sales/radar/settings");
  return { ok: true, message: "Saved." };
}
