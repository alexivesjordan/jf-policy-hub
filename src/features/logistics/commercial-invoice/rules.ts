/**
 * Pure domain logic for Pulse Logistics, deliberately independent of the
 * existing Pulse modules and of customs declarations submitted by Europa.
 */
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
  hsCode: string;
  originCountry: string;
  unitWeightKg: number | null;
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
};

export type InvoiceDraft = {
  reference: string;
  issueDate: string;
  orders: string[];
  seller: InvoiceParty;
  buyer: InvoiceParty;
  consignee: InvoiceParty;
  importer: InvoiceParty;
  frenchVatNumber: string;
  frenchFiscalRepresentativeVat: string;
  ddpModel: EuropaDdpModel;
  carrier: "Europa";
  entryCountry: "FR";
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
  signatory: string;
  notes: string;
  physicalShipmentConfirmed: boolean;
  lines: GoodsLine[];
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
    reference: "", issueDate: new Date().toISOString().slice(0, 10),
    orders: orders.map(o => o.orderNumber), seller,
    buyer: { ...first.buyer }, consignee: { ...first.consignee }, importer: blankParty(),
    frenchVatNumber: "", frenchFiscalRepresentativeVat: "",
    ddpModel: "unspecified", carrier: "Europa", entryCountry: "FR",
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
export const goodsTotal = (draft: InvoiceDraft) => roundMoney(shippedLines(draft).reduce((n,l) => n + (l.shippedQuantity * l.unitNetValue), 0));
export const declaredTotal = (draft: InvoiceDraft) => roundMoney(goodsTotal(draft) + draft.freightValue + draft.insuranceValue + draft.otherChargesValue);

const eu = new Set(["AT","BE","BG","HR","CY","CZ","DK","EE","FI","FR","DE","GR","HU","IE","IT","LV","LT","LU","MT","NL","PL","PT","RO","SK","SI","ES","SE"]);

export function validateCommercialInvoice(d: InvoiceDraft): string[] {
  const errors: string[] = [];
  const required = (value: string | undefined, name: string) => {
    if (!value?.trim()) errors.push(name + " is missing.");
    else if (value.length > 1000) errors.push(name + " is too long.");
  };
  required(d.reference,"Document reference");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.issueDate) || Number.isNaN(Date.parse(d.issueDate))) errors.push("Issue date is invalid.");
  for (const [label,party] of [["Seller",d.seller],["Buyer",d.buyer],["Consignee",d.consignee],["Importer",d.importer]] as const) {
    required(party.name,label + " name");
    required(party.address,label + " address");
  }
  required(d.seller.eori,"Seller EORI");
  required(d.seller.vat,"Seller VAT");
  required(d.importer.eori,"Importer EORI");
  required(d.destinationCountry,"Final destination country");
  required(d.clearanceCountry,"Customs clearance country");
  if (!/^[A-Z]{2}$/.test(d.destinationCountry)) errors.push("Final destination country must be a 2-letter ISO code.");
  if (!/^[A-Z]{2}$/.test(d.clearanceCountry)) errors.push("Clearance country must be a 2-letter ISO code.");
  if (!["DDP","DAP","EXW","FCA","CPT","CIP","DPU","FOB","FAS","CFR","CIF"].includes(d.incoterm)) errors.push("Select a valid Incoterm.");
  required(d.namedPlace,"Incoterm named place");
  if (d.incoterm === "DDP") {
    if (d.ddpModel === "unspecified" || d.ddpModel === "not_applicable")
      errors.push("Choose Europa's confirmed 2026 DDP Flow model.");
    if (d.ddpModel === "own_french_vat") {
      required(d.frenchVatNumber,"Jordan French VAT number");
      if (d.importer.name !== d.seller.name) errors.push("Verify Jordan is named as importer of record for the own-French-VAT model.");
    }
    if (d.ddpModel === "importers_signature") {
      required(d.importer.vat,"Importer VAT number");
      if (d.importer.name === d.seller.name) errors.push("The importer-signature model needs the confirmed EU importer, not Jordan.");
    }
  }
  if (d.procedure === "unconfirmed") errors.push("Customs procedure must be confirmed against Europa's shipment arrangements.");
  if (d.procedure === "42") {
    if (d.clearanceCountry !== "FR") errors.push("This workflow only supports Procedure 42 with verified French import clearance.");
    if (d.destinationCountry === "FR" || !eu.has(d.destinationCountry)) errors.push("Procedure 42 requires a different EU destination from France.");
    if (!d.buyer.vat.trim() || !d.buyer.vat.toUpperCase().startsWith(d.destinationCountry))
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
  if (!Number.isFinite(d.netWeightKg) || d.netWeightKg <= 0) errors.push("Confirmed net mass must be greater than zero.");
  if (!Number.isFinite(d.grossWeightKg) || d.grossWeightKg < d.netWeightKg || d.grossWeightKg <= 0) errors.push("Gross mass must be at least net mass.");
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
    if (line.shippedQuantity > 0) {
      if (!/^\d{6,10}$/.test(line.hsCode.replace(/[\s.]/g,""))) errors.push(name + " HS/commodity code requires 6-10 digits.");
      if (!/^[A-Z]{2}$/.test(line.originCountry)) errors.push(name + " origin country is missing or invalid.");
    }
  }
  return Array.from(new Set(errors));
}
