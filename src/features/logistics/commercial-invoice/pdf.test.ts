import { describe, expect, it } from "vitest";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument } from "pdf-lib";
import { extractText } from "unpdf";
import { draftFromOrders } from "./prepare";
import { planCommercialInvoice, renderCommercialInvoicePdf, type InvoicePageRole } from "./pdf";
import type { InvoiceOrder } from "./rules";

function orders(count: number): InvoiceOrder[] {
  return [{
    id: "sale-1",
    orderNumber: "SO-1",
    buyer: { name: "Αθήνα Gyms Α.Ε.", address: "Οδός 1\nŁódź", vat: "EL123", eori: "" },
    consignee: { name: "Αθήνα Gyms Α.Ε.", address: "Οδός 1, Łódź", vat: "", eori: "" },
    country: "GR",
    currency: "EUR",
    warnings: [],
    lines: Array.from({ length: count }, (_, index) => ({
      id: "s-" + index,
      orderNumber: "SO-1",
      sku: "JF-" + index,
      productName: "Ελληνικά Łódź Straße équipement " + index,
      orderedQuantity: 2,
      shippedQuantity: 2,
      unitNetValue: 10,
      lineNetPence: 2000,
      hsCode: "9506910000",
      originCountry: index % 2 ? "PL" : "CN",
      unitWeightKg: 1.25,
    })),
  }];
}

async function font() {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  return pdf.embedFont(await readFile(path.join(process.cwd(), "src/features/logistics/commercial-invoice/fonts/NotoSans-Regular.ttf")));
}

function draftFor(count: number) {
  const draft = draftFromOrders(orders(count), {
    incoterm: "DAP",
    namedPlace: "Αθήνα",
    destinationCountry: "GR",
    packages: 1,
    packageType: "Pallet",
    grossWeightKg: count * 3,
  });
  draft.reference = "CI-2026-0001";
  draft.shipment = {
    ...draft.shipment!,
    fao: "Alex",
    courier: "FedEx",
    parcels: 1,
    pallets: 1,
    dimensions: [{ lengthCm: 100, widthCm: 120, heightCm: 150, weightKg: 20 }],
    customsStatementId: "regime42",
    customsStatementText: "",
    issuedAt: "2026-11-19T12:26:00.000Z",
  };
  return draft;
}

async function planned(count: number, face = font()) {
  const draft = draftFor(count);
  return { draft, plan: planCommercialInvoice(draft, await face) };
}

async function pagesOf(count: number) {
  const { draft, plan } = await planned(count);
  const bytes = await renderCommercialInvoicePdf(draft);
  const text = await extractText(bytes, { mergePages: false });
  return { plan, bytes, text: text.text };
}

describe("commercial invoice PDF", () => {
  it("renders a one-page invoice with the summary on that page", async () => {
    const { plan, text } = await pagesOf(1);
    expect(plan.map((page) => page.role)).toEqual(["first"]);
    expect(plan[0]?.summary).toBe(true);
    expect(text).toHaveLength(1);
    expect(text[0]).toMatch(/Page:\s+1 of 1/);
    expect(text[0]).toMatch(/Goods Net/);
    expect(text[0]).toMatch(/COMMERCIAL INVOICE/);
  });

  it("renders first, continuation and last pages", async () => {
    const found = await findCount(3, ["first", "continuation", "last"]);
    const { plan, text } = await pagesOf(found);
    expect(plan.map((page) => page.role)).toEqual(["first", "continuation", "last"]);
    expect(plan.filter((page) => page.summary).map((_, index, all) => index)).toEqual([0]);
    expect(plan.at(-1)?.summary).toBe(true);
    expect(text).toHaveLength(3);
    expect(text[0]).toMatch(/COMMERCIAL INVOICE/);
    expect(text[1]).toMatch(/Document No:/);
    expect(text[1]).not.toMatch(/COMMERCIAL INVOICE/);
    expect(text[2]).toMatch(/Goods Net/);
    expect(text[2]).toMatch(/Page:\s+3 of 3/);
    await saveSample("invoice-3.pdf", found);
  });

  it("keeps the summary on the last page of an eight-page invoice", async () => {
    const found = await findCount(8);
    const { plan, text } = await pagesOf(found);
    expect(plan).toHaveLength(8);
    expect(plan[0]?.role).toBe("first");
    expect(plan.slice(1, -1).every((page) => page.role === "continuation" && !page.summary)).toBe(true);
    expect(plan[7]?.role).toBe("last");
    expect(plan[7]?.summary).toBe(true);
    expect(text[0]).toMatch(/Page:\s+1 of 8/);
    expect(text[7]).toMatch(/Page:\s+8 of 8/);
    expect(text[7]).toMatch(/Goods Net/);
    expect(text.slice(0, -1).some((page) => /Goods Net/.test(page))).toBe(false);
    await saveSample("invoice-1.pdf", 1);
    await saveSample("invoice-8.pdf", found);
  }, 20000);
});

async function findCount(pages: number, roles?: InvoicePageRole[]) {
  const face = await font();
  for (let count = 1; count < 400; count += 1) {
    const plan = planCommercialInvoice(draftFor(count), face);
    const rolesMatch = !roles || plan.every((page, index) => page.role === roles[index]);
    if (plan.length === pages && rolesMatch && plan.at(-1)?.summary && plan.slice(0, -1).every((page) => !page.summary)) return count;
  }
  throw new Error("No invoice length produced " + pages + " pages.");
}

async function saveSample(name: string, count: number) {
  const { draft } = await planned(count);
  const bytes = await renderCommercialInvoicePdf(draft);
  const dir = "/cursor/stores/self/ci-render";
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, name), bytes);
}
