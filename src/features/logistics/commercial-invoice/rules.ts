/**
 * Pure domain logic for Pulse Logistics, deliberately independent of the
 * existing Pulse modules and of customs declarations submitted by Europa.
 */
import { ISO3_TO_ISO2 } from "@/lib/iso3166";
export type EuropaDdpModel = "unspecified" | "importers_signature" | "own_french_vat" | "not_applicable";
export type CustomsProcedure = "unconfirmed" | "40" | "42" | "transit" | "other";

export type InvoiceParty = {
  name: string;
  address: string;
  vat: string;
  eori: string;
};

export type GoodsLine = {
  id: string;
  orderNumber: string;
  sku: string;
  productName: string;
  orderedQuantity: number;
  shippedQuantity: number;
  unitNetValue: number;
  /** Authoritative line net in pence for the ordered quantity. Totals use this, not a rounded unit price. */
  lineNetPence?: number;
  /** Pence for this shipment after largest-remainder allocation. Set from the stored invoice. */
  shippedPence?: number;
  hsCode: string;
  originCountry: string;
  unitWeightKg: number | null;
};

export type DimensionKind = "parcel" | "pallet";

/** `kind` is omitted on invoices issued before the row type existed. Those rows are pallets. */
export type PalletLine = { lengthCm: number; widthCm: number; depthCm: number; weightKg: number; kind?: DimensionKind };

export type InvoiceShipment = {
  fao: string;
  courier: string;
  despatchDate: string;
  deliveryAddress: string;
  contactName: string;
  contactEmail: string;
  specialInstructions: string;
  parcels: number;
  pallets: number;
  palletLines: PalletLine[];
  deliveryPence: number;
  surchargePence: number;
  vatPence: number;
  customsStatementId: string;
  customsStatementText: string;
  issuedAt: string;
};

export type InvoiceOrder = {
  id: string;
  orderNumber: string;
  buyer: InvoiceParty;
  consignee: InvoiceParty;
  country: string;
  currency: string;
  lines: GoodsLine[];
  warnings: string[];
  specialInstructions?: string;
  /** Freight and delivery charges from Cin7, in pence. Not a goods line. */
  deliveryPence?: number;
  contactName?: string;
  contactEmail?: string;
  courier?: string;
  deliveryCity?: string;
  /** Distinct Cin7 pack boxes. Empty when the sale has no pack lines. */
  boxes?: string[];
};

export type InvoiceDraft = {
  reference: string;
  issueDate: string;
  currency: string;
  orders: string[];
  seller: InvoiceParty;
  buyer: InvoiceParty;
  consignee: InvoiceParty;
  importer: InvoiceParty;
  frenchVatNumber: string;
  frenchFiscalRepresentativeVat: string;
  ddpModel: EuropaDdpModel;
  carrier: "Europa" | "FedEx" | "Collection" | "Other";
  entryCountry: string;
  clearanceCountry: string;
  destinationCountry: string;
  incoterm: string;
  namedPlace: string;
  procedure: CustomsProcedure;
  approvedStatement: string;
  statementApprovedBy: string;
  reasonForExport: string;
  packages: number;
  packageType: string;
  netWeightKg: number;
  grossWeightKg: number;
  freightValue: number;
  insuranceValue: number;
  otherChargesValue: number;
  shipmentRef: string;
  /** Delivery-address city. Used only to rebuild the Incoterms place when the country changes. */
  deliveryCity?: string;
  signatory: string;
  notes: string;
  physicalShipmentConfirmed: boolean;
  lines: GoodsLine[];
  shipment?: InvoiceShipment;
};

export function blankParty(): InvoiceParty {
  return { name: "", address: "", vat: "", eori: "" };
}

export function parseOrderNumbers(input: string): string[] {
  const values = input.split(/[,;\s]+/).map(v => v.trim().toUpperCase()).filter(Boolean);
  if (!values.length || values.length > 10) throw new Error("Enter between 1 and 10 order numbers.");
  if (values.some(v => !/^[A-Z0-9-]{1,40}$/.test(v))) throw new Error("Invalid order number.");
  if (new Set(values).size !== values.length) throw new Error("Duplicate order number.");
  return values;
}

const same = (a: string, b: string) => a.trim().toLowerCase().replace(/\s+/g, " ") === b.trim().toLowerCase().replace(/\s+/g, " ");
const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

/** A gap from £0.00 to £10.00 against the Cin7 line totals is accepted. Above that, refuse. */
export const INVOICE_TOLERANCE_PENCE = 1000;

export function toPence(amount: number) {
  return Math.round((amount + Number.EPSILON) * 100);
}

export function normaliseHsCode(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 6 || digits.length > 10) return null;
  return digits.padEnd(10, "0");
}

const NON_GOODS = /\b(service|installation|install|freight|delivery|carriage|shipping)\b/i;

export function isGoodsLine(line: { sku?: string | null; productName?: string | null; category?: string | null }) {
  const text = [line.sku, line.productName, line.category].filter(Boolean).join(" ");
  return !NON_GOODS.test(text);
}

export function vatCountryPrefix(country: string) {
  const iso = country.trim().toUpperCase();
  return iso === "GR" ? "EL" : iso;
}

export function countryName(iso: string) {
  const code = iso.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return code;
  const name = new Intl.DisplayNames(["en"], { type: "region" }).of(code);
  return name && name !== code ? name : code;
}

export function countryChoices() {
  return [...new Set(Object.values(ISO3_TO_ISO2))]
    .map((code) => ({ code, name: countryName(code) }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.code.localeCompare(b.code));
}

/** Incoterms named place: delivery city plus the destination country name. */
export function incotermPlace(city: string, countryIso: string) {
  const town = city.trim();
  const country = countryName(countryIso).trim();
  const named = /^[A-Z]{2}$/.test(countryIso.trim()) && country !== countryIso.trim().toUpperCase();
  if (town && named) return town + ", " + country;
  if (town) return town;
  return named ? country : "";
}

export function lineNetPence(line: GoodsLine) {
  if (line.lineNetPence != null) return line.lineNetPence;
  return toPence(line.orderedQuantity * line.unitNetValue);
}

/**
 * Pence for this shipment. Integer quantities use the largest-remainder method
 * across the ordered units, so every partial, including the last, sums to the Cin7 line total.
 */
export function shippedLinePence(line: GoodsLine, alreadyQty = 0) {
  const ordered = line.orderedQuantity;
  const shipped = line.shippedQuantity;
  if (shipped <= 0) return 0;
  if (alreadyQty < 0 || alreadyQty + shipped > ordered) throw new Error("Shipped quantity is above the remaining order quantity.");
  const total = lineNetPence(line);
  if (Number.isInteger(ordered) && Number.isInteger(shipped) && Number.isInteger(alreadyQty)) {
    const base = Math.floor(total / ordered);
    const extra = total - base * ordered;
    let sum = 0;
    for (let index = alreadyQty; index < alreadyQty + shipped; index += 1) sum += base + (index < extra ? 1 : 0);
    return sum;
  }
  const alreadyShare = alreadyQty <= 0 ? 0 : Math.round((total * alreadyQty) / ordered);
  if (alreadyQty + shipped === ordered) return total - alreadyShare;
  return Math.round((total * shipped) / ordered);
}

/** Stored shipment pence when the invoice has already been calculated, otherwise the allocation above. */
export function chargedLinePence(line: GoodsLine) {
  if (line.shippedPence != null) return line.shippedPence;
  return shippedLinePence(line);
}

export function unitPriceDriftPence(line: GoodsLine) {
  if (line.orderedQuantity <= 0) return 0;
  const total = lineNetPence(line);
  const unit = Math.round(total / line.orderedQuantity);
  return Math.abs(unit * line.orderedQuantity - total);
}

export function withinInvoiceTolerance(actualPence: number, expectedPence: number) {
  const gap = Math.abs(actualPence - expectedPence);
  return gap <= INVOICE_TOLERANCE_PENCE;
}

export function lineWeightKg(line: GoodsLine) {
  if (line.shippedQuantity <= 0 || line.unitWeightKg == null) return 0;
  return Math.round(line.unitWeightKg * line.shippedQuantity * 1000) / 1000;
}

export function summedNetWeightKg(lines: GoodsLine[]) {
  return Math.round(lines.reduce((sum, line) => sum + lineWeightKg(line), 0) * 1000) / 1000;
}

export function mergeInvoiceOrders(orders: InvoiceOrder[], seller: InvoiceParty): InvoiceDraft {
  if (!orders.length || orders.length > 10) throw new Error("Choose 1 to 10 orders.");
  const first = orders[0];
  if (orders.some(o => o.currency !== first.currency)) throw new Error("Different currencies cannot be merged.");
  if (orders.some(o => !same(o.buyer.name, first.buyer.name) || !same(o.buyer.address, first.buyer.address)))
    throw new Error("Different legal buyers cannot be merged without manual customs review.");
  if (orders.some(o => !same(o.consignee.name, first.consignee.name) || !same(o.consignee.address, first.consignee.address)))
    throw new Error("Different consignees or delivery addresses cannot be merged.");
  if (orders.some(o => o.country !== first.country)) throw new Error("Different destination countries cannot be merged.");
  const lines = orders.flatMap(o => o.lines);
  if (!lines.length || lines.length > 200) throw new Error("One invoice must contain 1 to 200 goods lines.");
  return {
    reference: "", issueDate: new Date().toISOString().slice(0, 10), currency: first.currency,
    orders: orders.map(o => o.orderNumber), seller,
    buyer: { ...first.buyer }, consignee: { ...first.consignee }, importer: blankParty(),
    frenchVatNumber: "", frenchFiscalRepresentativeVat: "",
    ddpModel: "not_applicable", carrier: "Other", entryCountry: "",
    clearanceCountry: "", destinationCountry: first.country,
    incoterm: "", namedPlace: "", procedure: "unconfirmed",
    approvedStatement: "", statementApprovedBy: "",
    reasonForExport: "Sale of goods", packages: 0, packageType: "",
    netWeightKg: 0, grossWeightKg: 0,
    freightValue: 0, insuranceValue: 0, otherChargesValue: 0,
    shipmentRef: "", signatory: "", notes: "", physicalShipmentConfirmed: false, lines,
  };
}

export const shippedLines = (draft: InvoiceDraft) => draft.lines.filter(l => l.shippedQuantity > 0);
export const goodsTotalPence = (draft: InvoiceDraft) => shippedLines(draft).reduce((sum, line) => sum + chargedLinePence(line), 0);
export const goodsTotal = (draft: InvoiceDraft) => roundMoney(goodsTotalPence(draft) / 100);
export const declaredTotal = (draft: InvoiceDraft) => roundMoney(goodsTotal(draft) + draft.freightValue + draft.insuranceValue + draft.otherChargesValue);

const eu = new Set(["AT","BE","BG","HR","CY","CZ","DK","EE","FI","FR","DE","GR","HU","IE","IT","LV","LT","LU","MT","NL","PL","PT","RO","SK","SI","ES","SE"]);
export function isEuCountry(iso: string) {
  return eu.has(iso.trim().toUpperCase());
}

export function validateCommercialInvoice(d: InvoiceDraft): string[] {
  const errors: string[] = [];
  const required = (value: string | undefined, name: string) => {
    if (!value?.trim()) errors.push(name + " is missing.");
    else if (value.length > 1000) errors.push(name + " is too long.");
  };
  required(d.reference,"Document reference");
  if (!/^[A-Z]{3}$/.test(d.currency)) errors.push("Select a three-letter invoice currency.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.issueDate) || Number.isNaN(Date.parse(d.issueDate))) errors.push("Issue date is invalid.");
  for (const [label,party] of [["Seller",d.seller],["Buyer",d.buyer],["Consignee",d.consignee]] as const) {
    required(party.name,label + " name");
    required(party.address,label + " address");
  }
  required(d.seller.eori,"Seller EORI");
  required(d.seller.vat,"Seller VAT");
  required(d.destinationCountry,"Final destination country");
  if (!/^[A-Z]{2}$/.test(d.destinationCountry)) errors.push("Final destination country must be a 2-letter ISO code.");
  if (d.clearanceCountry && !/^[A-Z]{2}$/.test(d.clearanceCountry)) errors.push("Clearance country must be a 2-letter ISO code.");
  if (!["DDP","DAP","EXW","FCA","CPT","CIP","DPU","FOB","FAS","CFR","CIF"].includes(d.incoterm)) errors.push("Select a valid Incoterm.");
  required(d.namedPlace,"Incoterm named place");
  if (d.incoterm === "DDP" && d.carrier === "Europa" && d.clearanceCountry === "FR" && d.ddpModel === "own_french_vat") {
    required(d.frenchVatNumber,"Jordan French VAT number");
    if (d.importer.name !== d.seller.name) errors.push("Verify Jordan is named as importer of record for the own-French-VAT model.");
  }
  if (d.incoterm === "DDP" && d.carrier === "Europa" && d.clearanceCountry === "FR" && d.ddpModel === "importers_signature") {
    required(d.importer.vat,"Importer VAT number");
    if (d.importer.name === d.seller.name) errors.push("The importer-signature model needs the confirmed EU importer, not Jordan.");
  }
  if (d.procedure === "42") {
    if (d.clearanceCountry !== "FR") errors.push("This workflow only supports Procedure 42 with verified French import clearance.");
    if (d.destinationCountry === "FR" || !eu.has(d.destinationCountry)) errors.push("Procedure 42 requires a different EU destination from France.");
    if (!d.buyer.vat.trim() || !d.buyer.vat.toUpperCase().startsWith(vatCountryPrefix(d.destinationCountry)))
      errors.push("Procedure 42 requires the confirmed destination-country buyer VAT number (or a documented transfer arrangement).");
    if (!d.frenchVatNumber.trim() && !d.frenchFiscalRepresentativeVat.trim())
      errors.push("Procedure 42 requires a confirmed French importer/fiscal-representative VAT identifier.");
  }
  if (d.procedure === "transit" && d.clearanceCountry === "FR") errors.push("Transit and French import clearance cannot both describe the same customs release.");
  if (d.procedure === "42" || d.procedure === "other") {
    required(d.approvedStatement, "Customs-approved procedure statement");
    required(d.statementApprovedBy, "Customs statement reviewer");
  }
  if (d.approvedStatement.trim()) required(d.statementApprovedBy, "Customs statement reviewer");
  required(d.reasonForExport,"Reason for export");
  required(d.packageType,"Package type");
  if (!Number.isSafeInteger(d.packages) || d.packages <= 0) errors.push("Number of packages must be greater than zero.");
  const summedNet = summedNetWeightKg(d.lines);
  if (summedNet <= 0) errors.push("Confirmed net mass must be greater than zero.");
  else if (Math.abs(d.netWeightKg - summedNet) > 0.001) errors.push("Net mass must equal the sum of the line weights.");
  if (!Number.isFinite(d.grossWeightKg) || d.grossWeightKg < d.netWeightKg || d.grossWeightKg <= 0) errors.push("Gross mass must be at least net mass.");
  else if (d.grossWeightKg > 100000) errors.push("Gross mass is too large.");
  for (const [name,amount] of [["Freight",d.freightValue],["Insurance",d.insuranceValue],["Other charges",d.otherChargesValue]] as const) {
    if (!Number.isFinite(amount) || amount < 0 || amount > 100000000) errors.push(name + " amount is invalid.");
  }
  required(d.signatory,"Signatory name");
  if (!d.physicalShipmentConfirmed) errors.push("Confirm the quantities against the physical shipment.");
  if (d.lines.length < 1 || d.lines.length > 200) errors.push("Invalid goods line count.");
  if (shippedLines(d).length === 0) errors.push("No goods selected for shipment.");
  for (const [index,line] of d.lines.entries()) {
    const name = "Line " + (index + 1);
    required(line.sku,name + " SKU"); required(line.productName,name + " item name");
    if (!d.orders.includes(line.orderNumber)) errors.push(name + " references an unselected order.");
    if (!Number.isFinite(line.orderedQuantity) || line.orderedQuantity <= 0
        || !Number.isFinite(line.shippedQuantity) || line.shippedQuantity < 0
        || line.shippedQuantity > line.orderedQuantity) errors.push(name + " shipped quantity is invalid.");
    if (!Number.isFinite(line.unitNetValue) || line.unitNetValue < 0 || line.unitNetValue > 100000000) errors.push(name + " unit price is invalid.");
    if (line.shippedQuantity > 0 && line.shippedQuantity <= line.orderedQuantity) {
      if (!normaliseHsCode(line.hsCode)) errors.push(name + " HS/commodity code requires 6-10 digits.");
      if (!/^[A-Z]{2}$/.test(line.originCountry)) errors.push(name + " origin country is missing or invalid.");
      if (line.unitWeightKg == null || !Number.isFinite(line.unitWeightKg) || line.unitWeightKg <= 0) errors.push(name + " weight is missing.");
      if (!withinInvoiceTolerance(shippedLinePence(line), toPence(line.shippedQuantity * line.unitNetValue))) {
        errors.push(name + " unit price does not reconcile to the line total.");
      }
    }
  }
  return Array.from(new Set(errors));
}
