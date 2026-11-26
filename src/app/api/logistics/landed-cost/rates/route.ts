import { z } from "zod";
import { apiError, json, logisticsGate } from "@/features/logistics/landed-cost/http-route";
import { listManualRates } from "@/features/logistics/landed-cost/store";
import { rateSchema } from "@/features/logistics/landed-cost/schema";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const gate = await logisticsGate();
  if (gate.response) return gate.response;
  try {
    return json({ rates: await listManualRates() });
  } catch (error) {
    return apiError(error, "Stored rates could not be read.");
  }
}

export async function POST(request: Request) {
  const gate = await logisticsGate();
  if (gate.response || !gate.profile) return gate.response;
  const parsed = rateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "Check the rate and try again." }, 400);
  const row = {
    destination_country: parsed.data.destination.toUpperCase(),
    origin_country: parsed.data.origin ? parsed.data.origin.toUpperCase() : null,
    hs_prefix: parsed.data.hsPrefix,
    duty_percent: parsed.data.dutyPercent,
    vat_percent: parsed.data.vatPercent,
    updated_by: gate.profile.id,
    updated_at: new Date().toISOString(),
  };
  try {
    const supabase = await createClient();
    const rates = () => supabase.schema("logistics").from("duty_rates");
    let existing = rates().select("id").eq("destination_country", row.destination_country).eq("hs_prefix", row.hs_prefix);
    existing = row.origin_country ? existing.eq("origin_country", row.origin_country) : existing.is("origin_country", null);
    const found = await existing.maybeSingle();
    if (found.error) throw new Error("That rate could not be saved.");
    const saved = found.data
      ? await rates().update(row).eq("id", found.data.id)
      : await rates().insert(row);
    if (saved.error) throw new Error("That rate could not be saved.");
    return json({ rates: await listManualRates() });
  } catch (error) {
    return apiError(error, "That rate could not be saved.");
  }
}

const removeSchema = z.object({ id: z.string().uuid() }).strict();

export async function DELETE(request: Request) {
  const gate = await logisticsGate();
  if (gate.response) return gate.response;
  const parsed = removeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "That rate could not be deleted." }, 400);
  try {
    const supabase = await createClient();
    const { error } = await supabase.schema("logistics").from("duty_rates").delete().eq("id", parsed.data.id);
    if (error) throw new Error("That rate could not be deleted.");
    return json({ rates: await listManualRates() });
  } catch (error) {
    return apiError(error, "That rate could not be deleted.");
  }
}
