import "server-only";

import { draftForRegenerate, dimensionRowsFromLines, type InvoicePrefill } from "./retrieve";
import type { InvoiceDraft } from "./rules";
import { createClient } from "@/lib/supabase/server";

function isDraft(value: unknown): value is InvoiceDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as InvoiceDraft;
  return Array.isArray(draft.lines) && typeof draft.buyer?.name === "string" && typeof draft.destinationCountry === "string";
}

export async function loadInvoicePrefill(id: string | undefined): Promise<InvoicePrefill | null> {
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const supabase = await createClient();
  const result = await supabase.schema("logistics").from("commercial_invoices")
    .select("document, cin7_orders, status")
    .eq("id", id)
    .maybeSingle();
  if (result.error || !result.data || result.data.status === "void") return null;
  const row = result.data as { document: unknown; cin7_orders: unknown; status: string };
  if (!isDraft(row.document)) return null;
  const numbers = Array.isArray(row.cin7_orders)
    ? row.cin7_orders.flatMap((item) => {
      if (!item || typeof item !== "object" || !("number" in item)) return [];
      const number = String((item as { number: unknown }).number ?? "").trim();
      return number ? [number] : [];
    })
    : row.document.orders;
  return {
    orderNumbers: numbers.join(", "),
    draft: draftForRegenerate(row.document, numbers),
    pallets: dimensionRowsFromLines(row.document.shipment?.palletLines),
  };
}
