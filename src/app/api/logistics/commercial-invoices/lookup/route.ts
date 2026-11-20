import { z } from "zod";
import { canUseSales } from "@/lib/access";
import { getCurrentProfile } from "@/lib/auth";
import { cin7IsConnected, getCin7Client, loadCin7BookingDetails } from "@/lib/cin7/client";
import { parseOrderNumbers, type InvoiceOrder, type InvoiceParty } from "@/features/logistics/commercial-invoice/rules";

const requestSchema = z.object({ orderNumbers: z.string().min(1).max(500) }).strict();

export async function POST(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) return Response.json({ error: "Sign in required." }, { status: 401 });
  if (!canUseSales(profile)) return Response.json({ error: "You do not have access to this feature." }, { status: 403 });
  if (!cin7IsConnected()) return Response.json({ error: "The Cin7 API is not configured in this environment." }, { status: 503 });
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Enter valid order numbers." }, { status: 400 });
  let numbers: string[];
  try { numbers = parseOrderNumbers(parsed.data.orderNumbers); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Invalid orders." }, { status: 400 }); }
  const client = getCin7Client();
  const results: InvoiceOrder[] = [];
  for (const orderNumber of numbers) {
    try {
      const sale = await client.getQuote(orderNumber);
      if (!sale) return Response.json({ error: "Could not find order " + orderNumber }, { status: 404 });
      if (sale.usedQuoteLines) return Response.json({ error: orderNumber + " is still a quotation or has no order lines. A commercial invoice needs a confirmed sale order." }, { status: 422 });
      if (!sale.lines.length) return Response.json({ error: orderNumber + " has no goods lines." }, { status: 422 });
      if (sale.moneyFlags?.length || sale.lines.some(line => line.lineNet === null || line.lineNet === undefined)) {
        return Response.json({ error: "Price reconciliation is incomplete for " + orderNumber + ". Review its values in Cin7." }, { status: 422 });
      }
      const shipping = await loadCin7BookingDetails(orderNumber);
      const buyer: InvoiceParty = { name: sale.customerName, address: "", vat: "", eori: "" };
      const consignee: InvoiceParty = {
        name: sale.customerName, address: shipping?.siteAddress ?? "", vat: "", eori: "",
      };
      results.push({
        id: sale.id, orderNumber: sale.number, buyer, consignee,
        country: "", currency: "",
        warnings: [
          "Verify legal buyer and consignee, currency and full addresses.",
          "Commodity codes and origin countries are not available from the existing Cin7 quote adapter.",
          "Check that line quantities describe goods physically in this consignment.",
          ...(!shipping?.siteAddress ? ["Delivery address could not be retrieved."] : []),
        ],
        lines: sale.lines.map((line, index) => ({
          id: sale.id + "-" + index, orderNumber: sale.number,
          sku: line.sku ?? "", productName: line.productName,
          orderedQuantity: line.qty, shippedQuantity: line.qty,
          unitNetValue: Math.round(((line.lineNet ?? 0) / line.qty) * 10000) / 10000,
          hsCode: "", originCountry: "", unitWeightKg: line.unitWeightKg ?? null,
        })),
      });
    } catch (error) {
      console.error("Pulse Logistics Cin7 lookup failed", { orderNumber, error: error instanceof Error ? error.message : "Unknown error" });
      return Response.json({ error: "Cin7 lookup failed for " + orderNumber + ". Please try again." }, { status: 502 });
    }
  }
  return Response.json({ orders: results }, { headers: { "Cache-Control": "no-store" } });
}
