import { describe, expect, it } from "vitest";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument } from "pdf-lib";
import { extractText } from "unpdf";
import { DDP_FISCAL_STATEMENTS } from "./ddp-statements";
import { applyBuyerVat } from "./statements";
import { applyShipment, draftFromOrders } from "./prepare";
import { commercialInvoicePageRoom, commercialInvoiceTrio, planCommercialInvoice, renderCommercialInvoicePdf, type InvoicePageRole } from "./pdf";
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
    expect(text).toMatch(/SPECIAL INSTRUCTIONS/);
  });

  it("prints a multi-line DDP statement without a blank line between every row", async () => {
    const eu = DDP_FISCAL_STATEMENTS.find((rule) => rule.destinationCountry === "EU")!.text;
    const nlSource = DDP_FISCAL_STATEMENTS.find((rule) => rule.destinationCountry === "NL")!.text;
    const nl = applyBuyerVat(nlSource, "NL863876584B01");
    const german = draftFor(1);
    german.incoterm = "DDP";
    german.destinationCountry = "DE";
    german.shipment = { ...german.shipment!, customsStatementId: "matched", customsStatementText: eu };
    const dutch = draftFor(1);
    dutch.incoterm = "DDP";
    dutch.destinationCountry = "NL";
    dutch.buyer.vat = "NL863876584B01";
    dutch.shipment = { ...dutch.shipment!, customsStatementId: "matched", customsStatementText: nl };
    const plain = draftFor(1);
    plain.shipment = { ...plain.shipment!, customsStatementId: "none", customsStatementText: "" };
    const read = async (draft: ReturnType<typeof draftFor>) => {
      const extracted = await extractText(await renderCommercialInvoicePdf(draft), { mergePages: true });
      return Array.isArray(extracted.text) ? extracted.text.join("\n") : extracted.text;
    };
    const germanText = await read(german);
    const dutchText = await read(dutch);
    const plainText = await read(plain);
    expect(germanText).toMatch(/Europa Road/);
    expect(germanText).toMatch(/FRZS 8888 63388/);
    expect(germanText).toMatch(/Article 138 EU VAT Directive/);
    expect(germanText).not.toMatch(/Europa Road\s*\n\s*\n\s*Cleared into EU Free Circulation/);
    expect(dutchText).toMatch(/NL863876584B01/);
    expect(dutchText).toMatch(/Dutch VAT law/);
    expect(dutchText).not.toMatch(/\{buyerVat\}/);
    expect(plainText).not.toMatch(/CUSTOMS STATEMENT/);
    const blankDutch = draftFor(1);
    blankDutch.incoterm = "DDP";
    blankDutch.destinationCountry = "NL";
    blankDutch.buyer.vat = "";
    blankDutch.shipment = { ...blankDutch.shipment!, customsStatementId: "matched", customsStatementText: applyBuyerVat(nlSource, "") };
    const blankText = await read(blankDutch);
    expect(blankText).toMatch(/Dutch VAT law/);
    expect(blankText).not.toMatch(/\{buyerVat\}|\(\s*\)/);
    await saveDraft("invoice-nl.pdf", dutch);
    await saveDraft("invoice-nl-blank.pdf", blankDutch);
    await saveDraft("invoice-de.pdf", german);
  });

  it("prints a single line whose HS code and origin came from Cin7", async () => {
    const { draft } = await planned(1);
    const line = draft.lines[0]!;
    line.sku = "JF-SFM-BLK-10-1200";
    line.productName = "Studio functional machine";
    line.orderedQuantity = 1;
    line.shippedQuantity = 1;
    line.hsCode = "9506919000";
    line.originCountry = "ES";
    line.unitWeightKg = 12;
    line.lineNetPence = 1000;
    line.unitNetValue = 10;
    draft.netWeightKg = 12;
    draft.grossWeightKg = 12;
    draft.shipment = {
      ...draft.shipment!,
      palletLines: [{ lengthCm: 120, widthCm: 100, depthCm: 80, weightKg: 12 }],
      pallets: 1,
      customsStatementId: "none",
      customsStatementText: "",
      specialInstructions: "",
    };
    const extracted = await extractText(await renderCommercialInvoicePdf(draft), { mergePages: true });
    const text = Array.isArray(extracted.text) ? extracted.text.join("\n") : extracted.text;
    expect(text).toMatch(/JF-SFM-BLK-10-1200/);
    expect(text).toMatch(/9506919000/);
    expect(text).toMatch(/Spain/);
    await saveDraft("invoice-hs-origin.pdf", draft);
  });

  it("prints the declaration marks and a Swiss named place", async () => {
    const { draft } = await planned(1);
    const line = draft.lines[0]!;
    line.sku = "JF-SFM-BLK-10-1200";
    line.productName = "Studio functional machine";
    line.orderedQuantity = 1;
    line.shippedQuantity = 1;
    line.hsCode = "9506919000";
    line.originCountry = "ES";
    line.unitWeightKg = 12;
    line.lineNetPence = 1000;
    line.unitNetValue = 10;
    draft.buyer.name = "NonStop Gym SA";
    draft.destinationCountry = "CH";
    draft.namedPlace = "Genève, Switzerland";
    draft.currency = "CHF";
    draft.issueDate = "2026-11-23";
    draft.netWeightKg = 12;
    draft.grossWeightKg = 12;
    draft.shipment = {
      ...draft.shipment!,
      courier: "FedEx",
      contactName: "Johann",
      contactEmail: "cornavin@nonstopgym.com",
      palletLines: [{ lengthCm: 120, widthCm: 80, depthCm: 100, weightKg: 12 }],
      pallets: 1,
      customsStatementId: "none",
      customsStatementText: "",
      specialInstructions: "",
    };
    const extracted = await extractText(await renderCommercialInvoicePdf(draft), { mergePages: true });
    const text = Array.isArray(extracted.text) ? extracted.text.join("\n") : extracted.text;
    expect(text).toMatch(/9506919000/);
    expect(text).toMatch(/Spain/);
    expect(text).toMatch(/\bDAP\b/);
    expect(text).not.toMatch(/DAP Genève|Switzerland/);
    for (const term of ["EXW", "DDP"] as const) {
      const other = draftFor(1);
      other.incoterm = term;
      other.namedPlace = "Genève, Switzerland";
      other.shipment = { ...other.shipment!, customsStatementId: "none", customsStatementText: "" };
      const extractedTerm = await extractText(await renderCommercialInvoicePdf(other), { mergePages: true });
      const termText = Array.isArray(extractedTerm.text) ? extractedTerm.text.join("\n") : extractedTerm.text;
      expect(termText).toMatch(new RegExp("\\b" + term + "\\b"));
      expect(termText).not.toMatch(/Genève|Switzerland/);
    }
    expect(text).toMatch(/23\/11\/2026/);
    expect(text).toMatch(/FedEx/);
    await saveDraft("invoice-ch.pdf", draft);
    const many = draftFor(8);
    many.destinationCountry = "CH";
    many.namedPlace = "Genève, Switzerland";
    many.issueDate = "2026-11-23";
    many.lines.forEach((row, index) => { row.originCountry = ["CN", "ES", "TW", "PL", "DE", "FR", "IT", "GB"][index]!; });
    await saveDraft("invoice-origins.pdf", many);
  });

  it("prints two Swiss parcels as parcels and a mixed DDP shipment with both types", async () => {
    const swiss = draftFor(3);
    swiss.incoterm = "DAP";
    swiss.destinationCountry = "CH";
    swiss.namedPlace = "Genève, Switzerland";
    swiss.buyer.name = "NonStop Gym SA";
    swiss.grossWeightKg = 43;
    swiss.shipment = {
      ...swiss.shipment!,
      parcels: 1,
      pallets: 2,
      palletLines: [
        { kind: "parcel", lengthCm: 20, widthCm: 14, depthCm: 133, weightKg: 33 },
        { kind: "parcel", lengthCm: 46, widthCm: 9, depthCm: 84, weightKg: 10 },
      ],
      customsStatementId: "none",
      customsStatementText: "",
    };
    const mixed = draftFor(1);
    mixed.incoterm = "DDP";
    mixed.destinationCountry = "DE";
    mixed.namedPlace = "Berlin, Germany";
    mixed.grossWeightKg = 63;
    mixed.shipment = {
      ...mixed.shipment!,
      parcels: 99,
      pallets: 99,
      palletLines: [
        { kind: "pallet", lengthCm: 120, widthCm: 100, depthCm: 150, weightKg: 20 },
        { kind: "parcel", lengthCm: 20, widthCm: 14, depthCm: 133, weightKg: 33 },
        { kind: "parcel", lengthCm: 46, widthCm: 9, depthCm: 84, weightKg: 10 },
      ],
      customsStatementId: "none",
      customsStatementText: "",
    };
    const read = async (draft: ReturnType<typeof draftFor>) => {
      const extracted = await extractText(await renderCommercialInvoicePdf(draft), { mergePages: true });
      return Array.isArray(extracted.text) ? extracted.text.join("\n") : extracted.text;
    };
    const swissText = await read(swiss);
    const mixedText = await read(mixed);
    expect(swissText).toMatch(/DIMENSIONS/);
    expect(swissText).not.toMatch(/PALLETS & DIMENSIONS/);
    expect(swissText).toMatch(/1 Parcel/);
    expect(swissText).toMatch(/2 Parcel/);
    expect(swissText).toMatch(/2 parcels/);
    expect(swissText).toMatch(/No\. of parcels[\s\S]{0,30}2/);
    expect(swissText).toMatch(/No\. of pallets[\s\S]{0,30}0/);
    expect(swissText).not.toMatch(/CUSTOMS STATEMENT|Genève|Switzerland|2 pallets/);
    expect(swissText).toMatch(/\bDAP\b/);
    expect(mixedText).toMatch(/1 Pallet/);
    expect(mixedText).toMatch(/1 pallet, 2 parcels/);
    expect(mixedText).toMatch(/No\. of parcels[\s\S]{0,30}2/);
    expect(mixedText).toMatch(/No\. of pallets[\s\S]{0,30}1/);
    expect(mixedText).toMatch(/\bDDP\b/);
    expect(mixedText).not.toMatch(/Berlin|Germany/);
    const revised = { ...swiss, reference: "CI-2026-0007-R2" };
    const revisedText = await read(revised);
    expect(revisedText).toMatch(/CI-2026-0007-R2/);
    expect(revisedText).not.toMatch(/CI-2026-0007-R2-R2/);
    await saveDraft("invoice-ch-parcels.pdf", swiss);
    await saveDraft("invoice-ddp-mixed.pdf", mixed);
    await saveDraft("invoice-r2.pdf", revised);
  });

  it("renders a one-page invoice with the summary on that page", async () => {
    const { plan, text } = await pagesOf(1);
    expect(plan.map((page) => page.role)).toEqual(["first"]);
    expect(plan[0]?.summary).toBe(true);
    expect(text).toHaveLength(1);
    expect(text[0]).toMatch(/Page:\s+1 of 1/);
    expect(text[0]).toMatch(/Goods net/);
    expect(text[0]).toMatch(/COMMERCIAL INVOICE/);
    expect(text[0]).toMatch(/Country of origin/);
    expect(text[0]).toMatch(/China/);
    expect(text[0]).toMatch(/Country of export/);
    expect(text[0]).toMatch(/United Kingdom/);
    expect(text[0]).toMatch(/Incoterms/);
    expect(text[0]).toMatch(/TOTALS \(EUR\)/);
    expect(text[0]).not.toMatch(/\bEuro\b/);
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
    expect(text[2]).toMatch(/Goods net/);
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
    expect(text[7]).toMatch(/Goods net/);
    expect(text.slice(0, -1).some((page) => /Goods net/.test(page))).toBe(false);
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
    expect(filledText).toMatch(/Incoterms/);
    expect(filledText).toMatch(/DDP/);
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
    expect(compact).toContain("China");
    expect(compact).toContain("Poland");
    expect(compact).toContain("UnitedKingdom");
    const joined = pages.join("\n");
    expect(joined).toContain("10 pallets");
    expect(joined).toContain("1.0");
    expect(joined).toContain("10.0");
    expect(pages[0]).toMatch(/COMMERCIAL INVOICE/);
    expect(pages.slice(1).every((page) => /Document No:/.test(page))).toBe(true);
    expect(pages.slice(1).some((page) => /COMMERCIAL INVOICE/.test(page))).toBe(false);
    const totalsPages = pages.filter((page) => /Goods net/.test(page));
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
        expect(kinds.indexOf("dims")).toBeLessThan(kinds.indexOf("boxes"));
        expect(kinds.indexOf("boxes")).toBeLessThan(kinds.indexOf("statement"));
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
    expect(pages.at(-1)).toMatch(/Goods net/);
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
    expect(text).toMatch(/Country of origin\s+Austria, Belgium,/);
    expect(text).toMatch(/Country of export[\s\S]{0,40}United Kingdom/);
    expect(text).toMatch(/Incoterms[\s\S]{0,20}DAP/);
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
    expect(ratedText).toMatch(/VAT[\s\S]{0,20}12\.34/);
    await saveDraft("invoice-vat.pdf", draft);
  });

  it("omits the statement and the note when both are absent", async () => {
    const draft = withPallets(draftFor(2), 12);
    const extracted = await extractText(await renderCommercialInvoicePdf(draft), { mergePages: true });
    const text = Array.isArray(extracted.text) ? extracted.text.join("\n") : extracted.text;
    expect(text).toMatch(/12 pallets/);
    expect(text).toMatch(/12\.0 kg/);
    expect(text).toMatch(/CUSTOMS STATEMENT/);
    await saveDraft("invoice-12-pallets.pdf", draft);
    const plain = draftFor(1);
    plain.shipment = { ...plain.shipment!, customsStatementId: "none", customsStatementText: "", specialInstructions: "" };
    const plainExtract = await extractText(await renderCommercialInvoicePdf(plain), { mergePages: true });
    const plainText = Array.isArray(plainExtract.text) ? plainExtract.text.join("\n") : plainExtract.text;
    expect(plainText).not.toMatch(/CUSTOMS STATEMENT/);
    expect(plainText).not.toMatch(/SPECIAL INSTRUCTIONS/);
    expect(plainText).toMatch(/DECLARATION/);
    await saveDraft("invoice-plain.pdf", plain);
  });

  it("gives the shipment, export and totals boxes one height and one row", async () => {
    const face = await font();
    const short = commercialInvoiceTrio(draftFor(1), face);
    expect(new Set(short.map((box) => box.h)).size).toBe(1);
    expect(new Set(short.map((box) => box.w)).size).toBe(1);
    expect(short[1]!.x - (short[0]!.x + short[0]!.w)).toBeCloseTo(6);
    expect(short[2]!.x - (short[1]!.x + short[1]!.w)).toBeCloseTo(6);
    const codes = ["CN", "ES", "TW", "PL", "DE", "FR", "IT", "NL", "BE", "PT", "SE", "AT"];
    const long = draftFor(codes.length);
    long.lines.forEach((line, index) => { line.originCountry = codes[index]!; });
    const wrapped = commercialInvoiceTrio(long, face);
    expect(wrapped[0]!.h).toBeGreaterThan(short[0]!.h);
    expect(new Set(wrapped.map((box) => box.h)).size).toBe(1);
    expect(wrapped[0]!.x).toBe(short[0]!.x);
    expect(wrapped[2]!.x + wrapped[2]!.w).toBeCloseTo(short[2]!.x + short[2]!.w);
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
