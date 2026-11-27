"use server";

import { revalidatePath } from "next/cache";
import { isFixtureMode } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { aggregateImport, type DateFormat, type ImportKind, type ImportMapping } from "@/lib/supply/csv";

function clean(error: { message?: string } | null) {
  return error?.message?.replace(/^app:\s*/, "") || "Could not save that.";
}

export async function saveReorderQty(formData: FormData) {
  if (isFixtureMode()) return;
  const supabase = await createClient();
  const { error } = await supabase.rpc("supply_set_qty", { p_id: String(formData.get("id") ?? ""), p_qty: Number(formData.get("qty")) });
  if (error) throw new Error(clean(error));
  revalidatePath("/supply/reorder");
}

export async function saveSupplier(formData: FormData) {
  if (isFixtureMode()) return;
  const supabase = await createClient();
  const { error } = await supabase.rpc("supply_save_supplier", {
    p_body: {
      id: String(formData.get("id") ?? ""),
      name: String(formData.get("name") ?? ""),
      leadTimeDays: formData.get("leadTimeDays") || null,
      moq: formData.get("moq") || null,
      orderMultiple: formData.get("orderMultiple") || null,
      currency: String(formData.get("currency") ?? "GBP"),
      active: formData.get("active") === "on",
    },
  });
  if (error) throw new Error(clean(error));
  revalidatePath("/supply/suppliers");
}

export async function saveSku(formData: FormData) {
  if (isFixtureMode()) return;
  const supabase = await createClient();
  const { error } = await supabase.rpc("supply_save_sku", {
    p_body: {
      sku: String(formData.get("sku") ?? ""),
      supplierId: String(formData.get("supplierId") ?? ""),
      leadTimeDays: formData.get("leadTimeDays") || null,
      leadTimeSource: String(formData.get("leadTimeSource") ?? "manual"),
      moq: formData.get("moq") || null,
      orderMultiple: formData.get("orderMultiple") || null,
      safetyDays: formData.get("safetyDays") || null,
      exclude: formData.get("exclude") === "on",
    },
  });
  if (error) throw new Error(clean(error));
  revalidatePath(`/supply/skus/${formData.get("sku")}`);
}

export async function saveSupplySettings(formData: FormData) {
  if (isFixtureMode()) return;
  const supabase = await createClient();
  const { error } = await supabase.rpc("supply_save_settings", {
    p_body: {
      serviceLevel: Number(formData.get("serviceLevel")),
      reviewDays: Number(formData.get("reviewDays")),
      defaultLeadTimeDays: Number(formData.get("defaultLeadTimeDays")),
      forecastMonths: Number(formData.get("forecastMonths")),
      zeroStockAlert: formData.get("zeroStockAlert") === "on",
      stockLocation: String(formData.get("stockLocation") ?? ""),
      smaWindow: Number(formData.get("smaWindow")),
      crostonAlpha: Number(formData.get("crostonAlpha")),
      initialLookbackMonths: Number(formData.get("initialLookbackMonths")),
    },
  });
  if (error) throw new Error(clean(error));
  revalidatePath("/supply/settings");
}

export async function saveMapping(formData: FormData) {
  if (isFixtureMode()) return;
  const supabase = await createClient();
  const columns = {
    date: String(formData.get("date") ?? ""),
    sku: String(formData.get("sku") ?? ""),
    qty: String(formData.get("qty") ?? ""),
    party: String(formData.get("party") ?? ""),
    poRef: String(formData.get("poRef") ?? ""),
    orderedOn: String(formData.get("orderedOn") ?? ""),
    receivedOn: String(formData.get("receivedOn") ?? ""),
    name: String(formData.get("nameColumn") ?? ""),
    currency: String(formData.get("currencyColumn") ?? ""),
    leadTime: String(formData.get("leadTime") ?? ""),
    moq: String(formData.get("moq") ?? ""),
    orderMultiple: String(formData.get("orderMultiple") ?? ""),
  };
  const { error } = await supabase.rpc("supply_save_mapping", {
    p_body: {
      id: String(formData.get("id") ?? ""),
      name: String(formData.get("mappingName") ?? ""),
      kind: String(formData.get("kind") ?? ""),
      dateFormat: String(formData.get("dateFormat") ?? "dd/mm/yyyy"),
      delimiter: String(formData.get("delimiter") ?? ","),
      columns: Object.fromEntries(Object.entries(columns).filter(([, value]) => value)),
    },
  });
  if (error) throw new Error(clean(error));
  revalidatePath("/supply/import");
}

export async function deleteMapping(formData: FormData) {
  if (isFixtureMode()) return;
  const supabase = await createClient();
  const { error } = await supabase.rpc("supply_delete_mapping", { p_id: String(formData.get("id") ?? "") });
  if (error) throw new Error(clean(error));
  revalidatePath("/supply/import");
}

export async function removeBatch(formData: FormData) {
  if (isFixtureMode()) return;
  const supabase = await createClient();
  const { error } = await supabase.rpc("supply_remove_batch", { p_batch: String(formData.get("id") ?? "") });
  if (error) throw new Error(clean(error));
  revalidatePath("/supply/import");
}

export async function saveAlias(formData: FormData) {
  if (isFixtureMode()) return;
  const supabase = await createClient();
  const { error } = await supabase.rpc("supply_save_alias", {
    p_body: { source: "orderwise", externalCode: String(formData.get("code") ?? ""), sku: String(formData.get("sku") ?? "") },
  });
  if (error) throw new Error(clean(error));
  revalidatePath("/supply/import");
}

export async function beginSupplyUpload(mappingId: string, fileName: string) {
  if (isFixtureMode()) return { batchId: "fixture", path: "fixture.csv", token: "fixture" };
  const supabase = await createClient();
  const admin = createAdminClient();
  if (!admin) return { error: "The service role key is not set." };
  const started = await supabase.rpc("supply_import_begin", { p_body: { mappingId, filePath: fileName } });
  if (started.error || typeof started.data !== "string") return { error: clean(started.error) };
  const path = `${started.data}/${fileName.replace(/[^\w.-]+/g, "_")}`;
  const signed = await admin.storage.from("supply-imports").createSignedUploadUrl(path);
  if (signed.error || !signed.data) return { error: "Could not prepare the upload." };
  await supabase.rpc("supply_import_begin", { p_body: { batchId: started.data, mappingId, filePath: path } });
  return { batchId: started.data, path: signed.data.path, token: signed.data.token };
}

export async function processSupplyUpload(batchId: string, mapping: ImportMapping) {
  if (isFixtureMode()) return { ok: true };
  const admin = createAdminClient();
  const supabase = await createClient();
  if (!admin) return { error: "The service role key is not set." };
  const batch = await supabase.rpc("supply_mappings");
  const filePath = Array.isArray((batch.data as { batches?: { id: string; filePath: string | null }[] } | null)?.batches)
    ? (batch.data as { batches: { id: string; filePath: string | null }[] }).batches.find((item) => item.id === batchId)?.filePath
    : null;
  if (!filePath) return { error: "That file is not on the import." };
  const downloaded = await admin.storage.from("supply-imports").download(filePath);
  if (downloaded.error || !downloaded.data) return { error: "Could not read the uploaded file." };
  const text = await downloaded.data.text();
  return applyParsedImport(supabase, batchId, text, mapping);
}

async function applyParsedImport(
  supabase: Awaited<ReturnType<typeof createClient>>,
  batchId: string,
  text: string,
  mapping: ImportMapping,
) {
  const seen = new Set<string>();
  aggregateImport(text, mapping, (code) => {
    seen.add(code);
    return null;
  });
  const codes = [...seen];
  const matched = await supabase.rpc("supply_match_codes", { p_source: "orderwise", p_codes: codes });
  if (matched.error) return { error: clean(matched.error) };
  const known = matched.data && typeof matched.data === "object" ? (matched.data as Record<string, string>) : {};
  const parsed = aggregateImport(text, mapping, (code) => known[code] ?? null);
  const chunks = chunk(parsed.demand, 500);
  const purchaseChunks = chunk(parsed.purchases, 500);
  const supplierChunks = chunk(parsed.suppliers, 200);
  const passes = Math.max(chunks.length, purchaseChunks.length, supplierChunks.length, 1);
  for (let index = 0; index < passes; index += 1) {
    const { error } = await supabase.rpc("supply_import_chunk", {
      p_batch: batchId,
      p_rows: {
        demand: chunks[index] ?? [],
        purchases: purchaseChunks[index] ?? [],
        suppliers: supplierChunks[index] ?? [],
        unmatched: index === 0 ? parsed.unmatched : [],
      },
    });
    if (error) return { error: clean(error) };
  }
  const finished = await supabase.rpc("supply_import_finish", {
    p_batch: batchId,
    p_body: { rowsRead: parsed.rowsRead, errors: parsed.errors },
  });
  if (finished.error) return { error: clean(finished.error) };
  revalidatePath("/supply/import");
  return { ok: true, unmatched: parsed.unmatched.length };
}

function chunk<T>(rows: T[], size: number) {
  const parts: T[][] = [];
  for (let index = 0; index < rows.length; index += size) parts.push(rows.slice(index, index + size));
  return parts;
}

export type { DateFormat, ImportKind };
