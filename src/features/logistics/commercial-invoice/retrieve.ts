import { incotermPlace, parseOrderNumbers, type InvoiceDraft, type InvoiceOrder, type PalletLine } from "./rules";

export type DimensionRow = {
  lengthCm: string;
  widthCm: string;
  depthCm: string;
  weightKg: string;
  kind: "parcel" | "pallet";
  box?: string;
};

export type InvoicePrefill = {
  orderNumbers: string;
  draft: InvoiceDraft;
  pallets: DimensionRow[];
};

export function emptyDimension(): DimensionRow {
  return { lengthCm: "", widthCm: "", depthCm: "", weightKg: "", kind: "parcel" };
}

export function sameOrderNumbers(typed: string, loaded: string[]) {
  try {
    const parsed = parseOrderNumbers(typed);
    return parsed.length === loaded.length && parsed.every((number, index) => number === loaded[index]);
  } catch {
    return false;
  }
}

export function dimensionRowsFromBoxes(boxes: string[]): DimensionRow[] {
  return boxes.slice(0, 30).map((box) => ({ ...emptyDimension(), box }));
}

export function dimensionRowsFromLines(lines: PalletLine[] | undefined): DimensionRow[] {
  if (!lines?.length) return [emptyDimension()];
  return lines.slice(0, 30).map((line) => ({
    lengthCm: Number.isFinite(line.lengthCm) ? String(line.lengthCm) : "",
    widthCm: Number.isFinite(line.widthCm) ? String(line.widthCm) : "",
    depthCm: Number.isFinite(line.depthCm) ? String(line.depthCm) : "",
    weightKg: Number.isFinite(line.weightKg) ? String(line.weightKg) : "",
    kind: line.kind === "pallet" ? "pallet" : "parcel",
  }));
}

export function dimensionsWereEdited(rows: DimensionRow[]) {
  return rows.length > 1 || rows.some((row) => row.lengthCm !== "" || row.widthCm !== "" || row.depthCm !== "" || row.weightKg !== "" || row.kind === "pallet" || Boolean(row.box));
}

/** A regeneration opens on the saved invoice, with the order's real quantities. */
export function draftForRegenerate(saved: InvoiceDraft, orderNumbers: string[]): InvoiceDraft {
  const today = new Date().toISOString().slice(0, 10);
  return {
    ...saved,
    reference: "PREVIEW",
    issueDate: today,
    orders: orderNumbers.length ? orderNumbers : saved.orders,
    lines: saved.lines.map((line) => ({ ...line, shippedQuantity: line.orderedQuantity })),
  };
}

export function incomingDraft(found: InvoiceOrder[]): InvoiceDraft {
  const first = found[0];
  const country = first?.country ?? "";
  const city = first?.deliveryCity ?? "";
  return {
    reference: "PREVIEW",
    issueDate: new Date().toISOString().slice(0, 10),
    currency: first?.currency ?? "",
    orders: found.map((order) => order.orderNumber),
    seller: first
      ? { ...first.buyer, name: "Jordan Fitness Ltd", address: "", vat: "", eori: "" }
      : { name: "", address: "", vat: "", eori: "" },
    buyer: first?.buyer ?? { name: "", address: "", vat: "", eori: "" },
    consignee: first?.consignee ?? { name: "", address: "", vat: "", eori: "" },
    importer: { name: "", address: "", vat: "", eori: "" },
    frenchVatNumber: "",
    frenchFiscalRepresentativeVat: "",
    ddpModel: "not_applicable",
    carrier: "Other",
    entryCountry: "",
    clearanceCountry: "",
    destinationCountry: country,
    incoterm: "DAP",
    namedPlace: incotermPlace(city, country),
    deliveryCity: city,
    procedure: "unconfirmed",
    approvedStatement: "",
    statementApprovedBy: "",
    reasonForExport: "Sale of goods",
    packages: 1,
    packageType: "Carton",
    netWeightKg: 0,
    grossWeightKg: 0,
    freightValue: 0,
    insuranceValue: 0,
    otherChargesValue: 0,
    shipmentRef: "",
    signatory: "Jordan Fitness Ltd",
    notes: "",
    physicalShipmentConfirmed: true,
    lines: found.flatMap((order) => order.lines),
    shipment: {
      fao: "",
      despatchDate: new Date().toISOString().slice(0, 10),
      deliveryAddress: first?.consignee.address ?? "",
      contactName: first?.contactName ?? "",
      contactEmail: first?.contactEmail ?? "",
      courier: first?.courier ?? "",
      specialInstructions: [...new Set(found.map((order) => order.specialInstructions?.trim()).filter((note): note is string => Boolean(note)))].join("\n"),
      parcels: 1,
      pallets: 0,
      palletLines: [],
      deliveryPence: found.reduce((sum, order) => sum + (order.deliveryPence ?? 0), 0),
      surchargePence: 0,
      vatPence: 0,
      customsStatementId: "matched",
      customsStatementText: "",
      issuedAt: new Date().toISOString(),
    },
  };
}

/** Retrieval fills fields the user has not edited. Edited fields stay as they are. */
export function mergeRetrievedDraft(current: InvoiceDraft | null, incoming: InvoiceDraft, fields: ReadonlySet<string>): InvoiceDraft {
  if (!current || fields.size === 0) return incoming;
  const next: InvoiceDraft = {
    ...incoming,
    shipment: incoming.shipment ? { ...incoming.shipment } : incoming.shipment,
  };
  if (fields.has("destinationCountry")) {
    next.destinationCountry = current.destinationCountry;
    next.namedPlace = current.namedPlace;
    next.deliveryCity = current.deliveryCity;
  }
  if (fields.has("incoterm")) {
    next.incoterm = current.incoterm;
    next.procedure = current.procedure;
    next.ddpModel = current.ddpModel;
    next.frenchVatNumber = current.frenchVatNumber;
    next.statementApprovedBy = current.statementApprovedBy;
    next.clearanceCountry = current.clearanceCountry;
    next.importer = current.importer;
    if (next.shipment && current.shipment) {
      next.shipment = {
        ...next.shipment,
        customsStatementId: current.shipment.customsStatementId,
        customsStatementText: current.shipment.customsStatementText,
      };
    }
  }
  if (fields.has("buyer")) next.buyer = current.buyer;
  if (fields.has("lines")) next.lines = current.lines;
  if (fields.has("shipment") && current.shipment && next.shipment) {
    const palletLines = next.shipment.palletLines;
    next.shipment = { ...next.shipment, ...current.shipment, palletLines };
  }
  return next;
}
