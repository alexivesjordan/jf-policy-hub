import type { Cin7Getter } from "@/lib/cin7/read-sale";

const ORDER_NUMBER = /^[A-Za-z0-9-]{1,40}$/;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type TrackerItem = {
  name: string;
  quantity: number;
};

/** Customer-safe Cin7 extract. No prices, notes, emails, phones, or staff names. */
export type TrackerSnapshot = {
  orderNumber: string;
  saleId: string;
  customerName: string;
  status: string;
  orderStatus: string | null;
  pickingStatus: string | null;
  packingStatus: string | null;
  shippingStatus: string | null;
  fulfilmentStatus: string | null;
  shipBy: string | null;
  requiredBy: string | null;
  carrier: string | null;
  trackingNumbers: string[];
  items: TrackerItem[];
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function list(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.map(record).filter((item): item is Record<string, unknown> => item !== null);
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function amount(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function saleIdOf(row: Record<string, unknown>) {
  return text(row.SaleID) ?? text(row.ID);
}

function clip(value: string | null, max: number) {
  if (!value) return null;
  return value.length > max ? value.slice(0, max) : value;
}

function trackingFrom(sale: Record<string, unknown>) {
  const found: string[] = [];
  const push = (value: string | null) => {
    if (!value || found.includes(value) || found.length >= 20) return;
    found.push(value.slice(0, 80));
  };
  const combined = text(sale.CombinedTrackingNumbers);
  if (combined) {
    for (const part of combined.split(/[,;]+/)) push(part.trim() || null);
  }
  for (const fulfilment of list(sale.Fulfilments)) {
    const status = text(fulfilment.FulFilmentStatus) ?? text(fulfilment.Status) ?? "";
    if (/void/i.test(status)) continue;
    push(text(fulfilment.TrackingNumber));
    const ship = record(fulfilment.Ship);
    push(text(ship?.TrackingNumber));
    for (const line of list(ship?.Lines)) push(text(line.TrackingNumber));
  }
  return found;
}

function itemLines(sale: Record<string, unknown>) {
  const orderLines = list(record(sale.Order)?.Lines).filter((line) => (amount(line.Quantity) ?? 0) > 0);
  const source = orderLines.length > 0 ? orderLines : list(record(sale.Quote)?.Lines).filter((line) => (amount(line.Quantity) ?? 0) > 0);
  const items: TrackerItem[] = [];
  for (const line of source) {
    if (items.length >= 200) break;
    const name = text(line.Name) ?? text(line.SKU);
    const quantity = amount(line.Quantity);
    if (!name || quantity == null || quantity < 0) continue;
    items.push({ name: name.slice(0, 200), quantity });
  }
  return items;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Read a snapshot that has already been filtered. Drops anything outside the allowlist. */
export function parseTrackerSnapshot(value: unknown): TrackerSnapshot | null {
  const row = record(value);
  if (!row) return null;
  const orderNumber = text(row.orderNumber);
  const saleId = text(row.saleId);
  const status = text(row.status);
  if (!orderNumber || !ORDER_NUMBER.test(orderNumber) || !saleId || !GUID.test(saleId) || !status) return null;
  const items: TrackerItem[] = [];
  for (const item of list(row.items)) {
    const name = text(item.name);
    const quantity = numberValue(item.quantity);
    if (!name || quantity == null || quantity < 0) continue;
    items.push({ name, quantity });
  }
  const trackingNumbers = Array.isArray(row.trackingNumbers)
    ? row.trackingNumbers.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0).map((entry) => entry.trim())
    : [];
  return {
    orderNumber,
    saleId,
    customerName: (text(row.customerName) ?? "").slice(0, 160),
    status,
    orderStatus: text(row.orderStatus),
    pickingStatus: text(row.pickingStatus),
    packingStatus: text(row.packingStatus),
    shippingStatus: text(row.shippingStatus),
    fulfilmentStatus: text(row.fulfilmentStatus),
    shipBy: text(row.shipBy),
    requiredBy: text(row.requiredBy),
    carrier: text(row.carrier),
    trackingNumbers,
    items,
  };
}

/** Keep only the fields a customer page is allowed to store. */
export function trackerSnapshotFromSale(sale: unknown, fallbackOrderNumber?: string): TrackerSnapshot | null {
  const row = record(sale);
  if (!row) return null;
  const saleId = saleIdOf(row);
  const orderNumber = text(record(row.Order)?.SaleOrderNumber) ?? text(fallbackOrderNumber);
  const status = text(row.Status);
  if (!saleId || !GUID.test(saleId) || !orderNumber || !ORDER_NUMBER.test(orderNumber) || !status) return null;
  return {
    orderNumber,
    saleId,
    customerName: (text(row.Customer) ?? "").slice(0, 160),
    status: status.slice(0, 40),
    orderStatus: clip(text(record(row.Order)?.Status), 80),
    pickingStatus: clip(text(row.CombinedPickingStatus), 80),
    packingStatus: clip(text(row.CombinedPackingStatus), 80),
    shippingStatus: clip(text(row.CombinedShippingStatus), 80),
    fulfilmentStatus: clip(text(row.FulFilmentStatus), 80),
    shipBy: clip(text(row.ShipBy), 40),
    requiredBy: clip(text(row.RequiredBy) ?? text(record(row.Order)?.RequiredBy), 40),
    carrier: clip(text(row.Carrier), 80),
    trackingNumbers: trackingFrom(row),
    items: itemLines(row),
  };
}

async function findSale(orderNumber: string, get: Cin7Getter) {
  for (let page = 1; page <= 3; page += 1) {
    const body = record(await get("saleList", { Search: orderNumber, Page: String(page), Limit: "100" }));
    const rows = list(body?.SaleList);
    const exact = rows.filter((row) => text(row.OrderNumber)?.toLowerCase() === orderNumber.toLowerCase());
    if (exact.length > 1) throw new Error("More than one Cin7 sale has that order number.");
    if (exact.length === 1) return exact[0];
    const total = amount(body?.Total) ?? rows.length;
    if (rows.length === 0 || page * 100 >= total) return null;
  }
  return null;
}

/** Sale GET only. Does not read the customer or product endpoints. */
export async function readTrackerSale(orderNumberOrId: string, get: Cin7Getter): Promise<TrackerSnapshot | null> {
  const lookup = orderNumberOrId.trim();
  if (!lookup) return null;
  let sale: Record<string, unknown> | null = null;
  if (GUID.test(lookup)) {
    sale = record(await get("sale", { ID: lookup }));
  } else {
    if (!ORDER_NUMBER.test(lookup)) throw new Error("Enter an order number such as SO-00490.");
    const listed = await findSale(lookup, get);
    const id = listed ? saleIdOf(listed) : null;
    if (!id) return null;
    sale = record(await get("sale", { ID: id }));
  }
  if (!sale) return null;
  return trackerSnapshotFromSale(sale, ORDER_NUMBER.test(lookup) ? lookup : undefined);
}
