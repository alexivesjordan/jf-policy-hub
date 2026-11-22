import "server-only";

import { commercialInvoiceFileName, commercialInvoiceObjectPath } from "./filename";
import { renderCommercialInvoicePdf } from "./pdf";
import type { InvoiceDraft } from "./rules";
import { createAdminClient } from "@/lib/supabase/admin";

export type StoredInvoice = {
  id: string;
  number: string;
  document: InvoiceDraft;
  pdfPath: string | null;
  pdfFilename: string | null;
  issuedBy: string;
};

export async function storeInvoicePdf(saved: StoredInvoice) {
  const filename = saved.pdfFilename || commercialInvoiceFileName({
    buyer: saved.document.buyer?.name ?? "Buyer",
    number: saved.number,
    incoterm: saved.document.incoterm,
  });
  if (saved.pdfPath) return filename;
  const admin = createAdminClient();
  if (!admin) throw new Error("app: That invoice could not be saved.");
  const bytes = await renderCommercialInvoicePdf({ ...saved.document, reference: saved.number });
  const storagePath = commercialInvoiceObjectPath(saved.id, saved.number);
  const uploaded = await admin.storage.from("commercial-invoices").upload(storagePath, Buffer.from(bytes), {
    contentType: "application/pdf",
    upsert: false,
  });
  const duplicate = uploaded.error && /already exists|duplicate/i.test(uploaded.error.message);
  if (uploaded.error && !duplicate) throw new Error("app: That invoice could not be saved.");
  const attached = await admin.rpc("logistics_attach_invoice_pdf", {
    p_id: saved.id,
    p_path: storagePath,
    p_filename: filename,
    p_issued_by: saved.issuedBy,
  });
  if (!attached.error) return filename;
  const current = await admin.schema("logistics").from("commercial_invoices").select("pdf_path").eq("id", saved.id).maybeSingle();
  if (current.data?.pdf_path) return filename;
  throw new Error("app: That invoice could not be saved.");
}
