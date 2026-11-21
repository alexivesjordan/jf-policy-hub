import { z } from "zod";
import { requireLogisticsApi } from "@/features/logistics/commercial-invoice/access";
import { rulesFromRows, type StatementRule } from "@/features/logistics/commercial-invoice/statements";
import { createClient } from "@/lib/supabase/server";

const writeSchema = z.object({
  id: z.string().uuid().optional(),
  incoterm: z.string().max(12).nullable().optional(),
  destinationCountry: z.string().max(8).nullable().optional(),
  carrier: z.string().max(120).nullable().optional(),
  statementText: z.string().min(1).max(2000),
  extraLine: z.string().max(200).nullable().optional(),
  priority: z.number().int().min(0).max(1000),
  active: z.boolean(),
}).strict();

function blank(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
}

export async function GET() {
  const gate = await requireLogisticsApi();
  if (gate.error || !gate.profile) return Response.json({ error: gate.error ?? "Sign in required." }, { status: gate.status });
  const supabase = await createClient();
  const result = await supabase.schema("logistics").from("customs_statement_rules")
    .select("id, incoterm, destination_country, carrier, statement_text, extra_line, priority, active")
    .order("priority", { ascending: false });
  if (result.error) return Response.json({ error: "The rules could not be read." }, { status: 422 });
  const rules = (result.data ?? []).map((row) => {
    const mapped = rulesFromRows([row])[0] as StatementRule;
    return { ...mapped, id: String((row as { id: string }).id) };
  });
  return Response.json({ rules }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const gate = await requireLogisticsApi();
  if (gate.error || !gate.profile) return Response.json({ error: gate.error ?? "Sign in required." }, { status: gate.status });
  const parsed = writeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "That rule could not be read." }, { status: 400 });
  const row = {
    incoterm: blank(parsed.data.incoterm)?.toUpperCase() ?? null,
    destination_country: blank(parsed.data.destinationCountry)?.toUpperCase() ?? null,
    carrier: blank(parsed.data.carrier),
    statement_text: parsed.data.statementText.trim(),
    extra_line: blank(parsed.data.extraLine),
    priority: parsed.data.priority,
    active: parsed.data.active,
    updated_at: new Date().toISOString(),
  };
  const supabase = await createClient();
  const saved = parsed.data.id
    ? await supabase.schema("logistics").from("customs_statement_rules").update(row).eq("id", parsed.data.id)
    : await supabase.schema("logistics").from("customs_statement_rules").insert({ ...row, created_by: gate.profile.id });
  if (saved.error) return Response.json({ error: "That rule could not be saved." }, { status: 422 });
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
