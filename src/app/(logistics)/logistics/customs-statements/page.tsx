import { CustomsStatementRules } from "@/components/logistics/customs-statement-rules";
import { rulesFromRows, type StatementRule } from "@/features/logistics/commercial-invoice/statements";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Customs statements" };

export default async function CustomsStatementsPage() {
  const supabase = await createClient();
  const result = await supabase.schema("logistics").from("customs_statement_rules")
    .select("id, incoterm, destination_country, carrier, statement_text, extra_line, priority, active")
    .order("priority", { ascending: false });
  const initial = (result.data ?? []).map((row) => {
    const mapped = rulesFromRows([row])[0] as StatementRule;
    return { ...mapped, id: String((row as { id: string }).id) };
  });
  return (
    <div className="space-y-4">
      <h1 className="font-display text-4xl">Customs statements</h1>
      <CustomsStatementRules initial={initial} />
    </div>
  );
}
