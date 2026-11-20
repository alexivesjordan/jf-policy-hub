import { z } from "zod";
import { canUseSales } from "@/lib/access";
import { getCurrentProfile } from "@/lib/auth";
import { renderCommercialInvoicePdf } from "@/features/logistics/commercial-invoice/pdf";
import { validateCommercialInvoice } from "@/features/logistics/commercial-invoice/rules";


const party = z.object({
  name: z.string().max(200),
  address: z.string().max(1000),
  vat: z.string().max(80),
  eori: z.string().max(80),
});
const line = z.object({
  id: z.string().max(200), orderNumber: z.string().max(80),
  sku: z.string().max(100), productName: z.string().max(300),
  orderedQuantity: z.number().finite().nonnegative(),
  shippedQuantity: z.number().finite().nonnegative(),
  unitNetValue: z.number().finite().nonnegative(),
  hsCode: z.string().max(30), originCountry: z.string().max(8),
  unitWeightKg: z.number().finite().nonnegative().nullable(),
});
const draftSchema = z.object({
  reference: z.string().max(100), issueDate: z.string().max(30),
  currency: z.string().max(8), orders: z.array(z.string().max(80)).min(1).max(10),
  seller: party, buyer: party, consignee: party, importer: party,
  frenchVatNumber: z.string().max(80),
  frenchFiscalRepresentativeVat: z.string().max(80),
  ddpModel: z.enum(["unspecified", "importers_signature", "own_french_vat", "not_applicable"]),
  carrier: z.enum(["Europa","FedEx","Collection","Other"]),
  entryCountry: z.string().max(8), clearanceCountry: z.string().max(8),
  destinationCountry: z.string().max(8), incoterm: z.string().max(12),
  namedPlace: z.string().max(200), procedure: z.enum(["unconfirmed","40","42","transit","other"]),
  approvedStatement: z.string().max(2000), statementApprovedBy: z.string().max(200),
  reasonForExport: z.string().max(200),
  packages: z.number().int().nonnegative().max(100000),
  packageType: z.string().max(100),
  netWeightKg: z.number().finite().nonnegative().max(10000000),
  grossWeightKg: z.number().finite().nonnegative().max(10000000),
  freightValue: z.number().finite().nonnegative().max(100000000),
  insuranceValue: z.number().finite().nonnegative().max(100000000),
  otherChargesValue: z.number().finite().nonnegative().max(100000000),
  shipmentRef: z.string().max(100), signatory: z.string().max(150),
  notes: z.string().max(2000), physicalShipmentConfirmed: z.boolean(),
  lines: z.array(line).min(1).max(200),
}).strict();

export async function POST(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) return Response.json({ error: "Sign in required." }, { status: 401 });
  if (!canUseSales(profile)) return Response.json({ error: "Forbidden." }, { status: 403 });
  const raw = await request.text();
  if (raw.length > 350_000) return Response.json({ error: "Document request too large." }, { status: 413 });
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return Response.json({ error: "Invalid JSON." }, { status: 400 }); }
  const validated = draftSchema.safeParse(body);
  if (!validated.success) return Response.json({ error: "Malformed invoice data.", details: validated.error.issues.slice(0, 12).map(i => i.path.join(".") + ": " + i.message) }, { status: 400 });
  const errors = validateCommercialInvoice(validated.data);
  if (errors.length) return Response.json({ error: "Invoice requires review before PDF preview.", details: errors }, { status: 422 });
  try {
    const bytes = await renderCommercialInvoicePdf(validated.data);
    return new Response(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'inline; filename="commercial-invoice-preview.pdf"',
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("Commercial invoice PDF preview generation error", error);
    return Response.json({ error: "The PDF could not be generated. Check any special characters in addresses and try again." }, { status: 422 });
  }
}
