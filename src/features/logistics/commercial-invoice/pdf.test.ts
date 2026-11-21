import { describe, expect, it } from "vitest";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument } from "pdf-lib";
import { extractText } from "unpdf";
import { applyShipment, draftFromOrders } from "./prepare";
import { commercialInvoicePageRoom, planCommercialInvoice, renderCommercialInvoicePdf, type InvoicePageRole } from "./pdf";
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
    palletLines: [{ lengthCm: 120, widthCm: 100, depthCm: 150, weightKg: count * 3 }],
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
  it("prints the Cin7 shipping note even when the form sends a blank", async () => {
    const source = orders(1);
    source[0]!.specialInstructions = "Tail lift required";
    const built = draftFromOrders(source, {
      incoterm: "DAP",
      namedPlace: "Αθήνα",
      destinationCountry: "GR",
      packages: 1,
      packageType: "Pallet",
      grossWeightKg: 10,
    });
    built.reference = "CI-2026-0001";
    const applied = applyShipment(built, {
      specialInstructions: "",
      fao: "Alex",
      courier: "FedEx",
      parcels: 1,
      palletLines: [{ lengthCm: 120, widthCm: 100, depthCm: 150, weightKg: 10 }],
      customsStatementId: "regime42",
      customsStatementText: "",
    });
    const extracted = await extractText(await renderCommercialInvoicePdf(applied), { mergePages: true });
    const text = Array.isArray(extracted.text) ? extracted.text.join("\n") : extracted.text;
    expect(text).toMatch(/Tail lift required/);
    expect(text).toMatch(/Special Instructions/);
  });

  it("renders a one-page invoice with the summary on that page", async () => {
    const { plan, text } = await pagesOf(1);
    expect(plan.map((page) => page.role)).toEqual(["first"]);
    expect(plan[0]?.summary).toBe(true);
    expect(text).toHaveLength(1);
    expect(text[0]).toMatch(/Page:\s+1 of 1/);
    expect(text[0]).toMatch(/Goods Net/);
    expect(text[0]).toMatch(/COMMERCIAL INVOICE/);
    expect(text[0]).toMatch(/Country of Origin: China/);
    expect(text[0]).toMatch(/Country of Export: United Kingdom/);
    expect(text[0]).toMatch(/Incoterms: DAP/);
    expect(text[0]).not.toMatch(/Position:/);
  });

  it("renders first, continuation and last pages", async () => {
    const found = await findCount(3, ["first", "continuation", "last"]);
    const { plan, text } = await pagesOf(found);
    expect(plan.map((page) => page.role)).toEqual(["first", "continuation", "last"]);
    expect(plan.filter((page) => page.summary)).toHaveLength(1);
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
    await saveSample("invoice-10-pallets.pdf", 4, 10);
  }, 20000);

  it("prints a DDP invoice that only carries the customs statement", async () => {
    const { draft } = await planned(2);
    draft.incoterm = "DDP";
    draft.procedure = "unconfirmed";
    draft.ddpModel = "not_applicable";
    draft.importer = { name: "", address: "", vat: "", eori: "" };
    draft.clearanceCountry = "";
    draft.approvedStatement = "";
    draft.statementApprovedBy = "";
    draft.shipment = { ...draft.shipment!, customsStatementId: "ddp_vat_postponed", customsStatementText: "" };
    const plain = await extractText(await renderCommercialInvoicePdf(draft), { mergePages: true });
    const plainText = Array.isArray(plain.text) ? plain.text.join("\n") : plain.text;
    expect(plainText).toMatch(/Goods cleared regime 40 00 DDP VAT postponed/);
    expect(plainText).not.toMatch(/Importer:/);
    draft.importer = { name: "Frictionless Trade Services SAS", address: "70 Rue Mollien", vat: "", eori: "" };
    draft.clearanceCountry = "FR";
    const filled = await extractText(await renderCommercialInvoicePdf(draft), { mergePages: true });
    const filledText = Array.isArray(filled.text) ? filled.text.join("\n") : filled.text;
    expect(filledText).toMatch(/Incoterms: DDP/);
    expect(filledText).not.toMatch(/Importer:/);
  });

  it("keeps the full statement, instructions, description and a 40-line dimension list", async () => {
    const { draft } = await planned(3);
    const statement = "¶".repeat(2000);
    const instructions = "¤".repeat(2000);
    const description = "Kettlebell " + "Ω".repeat(240);
    draft.lines[0]!.productName = description;
    draft.lines[0]!.originCountry = "CN";
    draft.lines[1]!.originCountry = "GB";
    draft.lines[2]!.originCountry = "PL";
    draft.shipment = {
      ...draft.shipment!,
      customsStatementId: "custom",
      customsStatementText: statement,
      specialInstructions: instructions,
      palletLines: Array.from({ length: 10 }, (_, index) => ({ lengthCm: 120, widthCm: 100, depthCm: 150, weightKg: index + 1 })),
      pallets: 10,
    };
    const face = await font();
    const plan = planCommercialInvoice(draft, face);
    for (const page of plan) {
      expect(page.used).toBeLessThanOrEqual(commercialInvoicePageRoom(draft, page.role) + 0.1);
    }
    expect(plan.filter((page) => page.summary).length).toBeGreaterThan(1);
    expect(plan.slice(1).every((page) => page.role !== "first")).toBe(true);
    const bytes = await renderCommercialInvoicePdf(draft);
    const extracted = await extractText(bytes, { mergePages: false });
    const pages = extracted.text;
    const compact = pages.join("").replace(/\s+/g, "");
    expect(compact.match(/¶/g)?.length).toBe(2000);
    expect(compact.match(/¤/g)?.length).toBe(2000);
    expect(compact.match(/Ω/g)?.length).toBe(240);
    expect(compact).toContain("CountryofOrigin:China,Poland,UnitedKingdom");
    const joined = pages.join("\n");
    expect(joined).toContain("Pallet 1:");
    expect(joined).toContain("Pallet 10:");
    expect(pages[0]).toMatch(/COMMERCIAL INVOICE/);
    expect(pages.slice(1).every((page) => /Document No:/.test(page))).toBe(true);
    expect(pages.slice(1).some((page) => /COMMERCIAL INVOICE/.test(page))).toBe(false);
    const totalsPages = pages.filter((page) => /Goods Net/.test(page));
    expect(totalsPages).toHaveLength(1);
    expect(totalsPages[0]).toMatch(/Signed:/);
    expect(pages.filter((page) => /Signed:/.test(page))).toHaveLength(1);
    expect(plan.filter((page) => page.pieces.some((piece) => piece.kind === "closing"))).toHaveLength(1);
    expect(pages.at(-1)).toMatch(/Signed:/);
    expect(pages.at(-1)).toMatch(/¶/);
    await saveDraft("invoice-stress.pdf", draft);
  }, 20000);

  it("keeps the customs statement and signature on the last page for every length", async () => {
    const face = await font();
    for (let count = 1; count <= 160; count += 1) {
      const draft = draftFor(count);
      const plan = planCommercialInvoice(draft, face);
      const last = plan.at(-1);
      const maxTo = plan.reduce((max, page) => page.pieces.reduce((inner, piece) => piece.kind === "statement" ? Math.max(inner, piece.to) : inner, max), 0);
      const lastStatement = last?.pieces.find((piece) => piece.kind === "statement");
      expect(last?.pieces.some((piece) => piece.kind === "closing"), "closing on last page for " + count).toBe(true);
      expect(lastStatement?.kind === "statement" ? lastStatement.to : 0, "statement ending on last page for " + count).toBe(maxTo);
      expect(maxTo, "statement present for " + count).toBeGreaterThan(0);
      expect(plan.slice(0, -1).every((page) => !page.pieces.some((piece) => piece.kind === "closing")), "closing only on last page for " + count).toBe(true);
    }
    for (const count of [1, 40, 80, 120, 160]) {
      const { text } = await pagesOf(count);
      expect(text.at(-1), "rendered last page " + count).toMatch(/Signed:/);
      expect(text.at(-1)).toMatch(/Regime 42/);
      expect(text.slice(0, -1).some((page) => /Regime 42|Signed:/.test(page))).toBe(false);
    }
  }, 30000);

  it("keeps pallets, the statement and the signature together on the last page", async () => {
    const face = await font();
    for (let pallets = 1; pallets <= 30; pallets += 1) {
      for (let count = 1; count <= 160; count += 1) {
        const draft = withPallets(draftFor(count), pallets);
        draft.lines.forEach((line) => { line.productName = "Bench"; });
        const plan = planCommercialInvoice(draft, face);
        const last = plan.at(-1);
        const kinds = last?.pieces.map((piece) => piece.kind) ?? [];
        expect(kinds.indexOf("dims"), pallets + " pallets, " + count + " lines").toBeGreaterThanOrEqual(0);
        expect(kinds.indexOf("dims")).toBeLessThan(kinds.indexOf("statement"));
        expect(kinds.indexOf("statement")).toBeLessThan(kinds.indexOf("closing"));
        expect(plan.slice(0, -1).every((page) => page.pieces.length === 0)).toBe(true);
        expect(last && last.used).toBeLessThanOrEqual(commercialInvoicePageRoom(draft, last?.role ?? "last") + 0.1);
      }
    }
  }, 120000);

  it("keeps the end of a long statement with the signature", async () => {
    const { draft } = await planned(8);
    const lines = Array.from({ length: 45 }, (_, index) => index === 44 ? "STATEMENT-END" : "STATEMENT-LINE-" + index);
    draft.shipment = {
      ...draft.shipment!,
      customsStatementId: "custom",
      customsStatementText: lines.join("\n"),
      palletLines: Array.from({ length: 10 }, (_, index) => ({ lengthCm: 120, widthCm: 100, depthCm: 150, weightKg: index + 1 })),
      pallets: 10,
    };
    const bytes = await renderCommercialInvoicePdf(draft);
    const extracted = await extractText(bytes, { mergePages: false });
    const pages = extracted.text;
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.at(-1)).toMatch(/STATEMENT-END/);
    expect(pages.at(-1)).toMatch(/Signed:/);
    expect(pages.at(-1)).toMatch(/Goods Net/);
    expect(pages.slice(0, -1).some((page) => /STATEMENT-END/.test(page))).toBe(false);
  });

  it("keeps the pallet total with the last pallet row", async () => {
    const face = await font();
    for (let pallets = 1; pallets <= 30; pallets += 1) {
      for (const count of [1, 40, 80, 160]) {
        const draft = withPallets(draftFor(count), pallets);
        draft.lines.forEach((line) => { line.productName = "Bench"; });
        draft.shipment = { ...draft.shipment!, customsStatementId: "custom", customsStatementText: "Cleared for export.\n".repeat(20) };
        const plan = planCommercialInvoice(draft, face);
        for (const page of plan) {
          for (const piece of page.pieces) {
            if (piece.kind === "dims" && piece.to === pallets + 1) {
              expect(piece.from, pallets + " pallets, " + count + " lines").toBeLessThanOrEqual(pallets - 1);
            }
          }
        }
      }
    }
  });

  it("prints a long origin list on the same line as its label", async () => {
    const codes = ["CN", "ES", "TW", "PL", "DE", "FR", "IT", "NL", "BE", "PT", "SE", "AT"];
    const draft = draftFor(codes.length);
    draft.lines.forEach((line, index) => { line.originCountry = codes[index]!; });
    const extracted = await extractText(await renderCommercialInvoicePdf(draft), { mergePages: true });
    const text = Array.isArray(extracted.text) ? extracted.text.join("\n") : extracted.text;
    expect(text).toMatch(/Country of Origin: Austria, Belgium, China/);
    expect(text).toMatch(/Country of Export: United Kingdom/);
    expect(text).toMatch(/Incoterms: DAP/);
    await saveDraft("invoice-origins.pdf", draft);
  });

  it("leaves line VAT at 0.00 unless a VAT total was entered", async () => {
    const { draft } = await planned(1);
    const zero = await extractText(await renderCommercialInvoicePdf(draft), { mergePages: true });
    const zeroText = Array.isArray(zero.text) ? zero.text.join("\n") : zero.text;
    expect(zeroText).toMatch(/20\.00\s+0\.00\s+2\.50/);
    draft.shipment = { ...draft.shipment!, vatPence: 1234 };
    const rated = await extractText(await renderCommercialInvoicePdf(draft), { mergePages: true });
    const ratedText = Array.isArray(rated.text) ? rated.text.join("\n") : rated.text;
    expect(ratedText).toMatch(/20\.00\s+-\s+2\.50/);
    expect(ratedText).toMatch(/VAT:\s+12\.34/);
  });
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

function withPallets(draft: ReturnType<typeof draftFor>, count: number) {
  const each = Math.max(1, Math.ceil((draft.grossWeightKg / count) * 10) / 10);
  draft.shipment = {
    ...draft.shipment!,
    pallets: count,
    palletLines: Array.from({ length: count }, () => ({ lengthCm: 120, widthCm: 100, depthCm: 150, weightKg: each })),
  };
  draft.grossWeightKg = Math.round(each * count * 10) / 10;
  return draft;
}

async function saveSample(name: string, count: number, pallets = 2) {
  const { draft } = await planned(count);
  await saveDraft(name, withPallets(draft, pallets));
}

async function saveDraft(name: string, draft: Awaited<ReturnType<typeof planned>>["draft"]) {
  const dir = process.env.CI_RENDER_DIR;
  if (!dir) return;
  const bytes = await renderCommercialInvoicePdf(draft);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, name), bytes);
}
