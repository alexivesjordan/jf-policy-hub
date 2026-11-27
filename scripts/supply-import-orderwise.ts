/**
 * TEST only. Load an Orderwise CSV into Pulse Supply with a saved mapping.
 * Refuses every Supabase host except the TEST project jqdhkrlopmgbwbjebgxy.
 *
 * npx tsx scripts/supply-import-orderwise.ts --file history.csv --mapping mapping.json
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { aggregateImport, type ImportMapping } from "../src/lib/supply/csv";

const TEST_HOST = "jqdhkrlopmgbwbjebgxy.supabase.co";

function arg(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

async function main() {
  const file = arg("--file");
  const mappingPath = arg("--mapping");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!file || !mappingPath) {
    console.error("Pass --file and --mapping.");
    process.exit(1);
  }
  if (!url.includes(TEST_HOST)) {
    console.error("This importer only runs against the TEST database.");
    process.exit(1);
  }
  if (!key) {
    console.error("The service role key is not set.");
    process.exit(1);
  }
  const mapping = JSON.parse(readFileSync(mappingPath, "utf8")) as ImportMapping & { mappingId: string };
  const text = readFileSync(file, "utf8");
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const seen = new Set<string>();
  aggregateImport(text, mapping, (code) => {
    seen.add(code);
    return null;
  });
  const matched = await supabase.rpc("supply_match_codes", { p_source: "orderwise", p_codes: [...seen] });
  if (matched.error) throw new Error("Could not match codes.");
  const known = matched.data && typeof matched.data === "object" ? (matched.data as Record<string, string>) : {};
  const parsed = aggregateImport(text, mapping, (code) => known[code] ?? null);
  const started = await supabase.rpc("supply_import_begin", { p_body: { mappingId: mapping.mappingId, filePath: file } });
  if (started.error || typeof started.data !== "string") throw new Error("Could not open a batch.");
  const batchId = started.data;
  const parts = Math.max(Math.ceil(parsed.demand.length / 500), Math.ceil(parsed.purchases.length / 500), Math.ceil(parsed.suppliers.length / 200), 1);
  for (let index = 0; index < parts; index += 1) {
    const { error } = await supabase.rpc("supply_import_chunk", {
      p_batch: batchId,
      p_rows: {
        demand: parsed.demand.slice(index * 500, (index + 1) * 500),
        purchases: parsed.purchases.slice(index * 500, (index + 1) * 500),
        suppliers: parsed.suppliers.slice(index * 200, (index + 1) * 200),
        unmatched: index === 0 ? parsed.unmatched : [],
      },
    });
    if (error) throw new Error("Could not load the batch.");
  }
  const finished = await supabase.rpc("supply_import_finish", { p_batch: batchId, p_body: { rowsRead: parsed.rowsRead, errors: parsed.errors } });
  if (finished.error) throw new Error("Could not finish the batch.");
  console.log(`rows=${parsed.rowsRead} loaded=${parsed.demand.length + parsed.purchases.length + parsed.suppliers.length} unmatched=${parsed.unmatched.length}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Import failed.");
  process.exit(1);
});
