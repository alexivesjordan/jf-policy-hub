/** Turn Cin7 JSON into supply rows. Unknown shapes are skipped. Payloads are not logged. */

const SALE_DEMAND = new Set([
  "ORDERED",
  "BACKORDERED",
  "PICKING",
  "PICKED",
  "PACKING",
  "PACKED",
  "SHIPPING",
  "INVOICING",
  "INVOICED",
  "COMPLETED",
]);

const PURCHASE_KEEP = new Set(["ORDERED", "RECEIVING", "RECEIVED", "INVOICED", "COMPLETED", "PARTIALLY RECEIVED", "FULLY RECEIVED"]);

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function rows(value: unknown) {
  return Array.isArray(value) ? value.flatMap((item) => {
    const row = record(item);
    return row ? [row] : [];
  }) : [];
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function num(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return 0;
}

function listOf(root: Record<string, unknown> | null, key: string) {
  return rows(root?.[key]);
}

export function pageDone(body: unknown, page: number, limit: number) {
  const root = record(body);
  const total = root?.Total;
  if (typeof total === "number" && Number.isFinite(total)) return page * limit >= total;
  const lists = ["Products", "SupplierList", "ProductAvailabilityList", "SaleList", "PurchaseList"];
  const length = lists.reduce((found, key) => found + (Array.isArray(root?.[key]) ? root[key].length : 0), 0);
  return length < limit;
}

export function parseProducts(body: unknown) {
  return listOf(record(body), "Products").flatMap((row) => {
    const sku = text(row.SKU);
    if (!sku) return [];
    return [{ sku, label: text(row.Name) ?? sku }];
  });
}

export function parseSuppliers(body: unknown) {
  return listOf(record(body), "SupplierList").flatMap((row) => {
    const cin7SupplierId = text(row.ID);
    const name = text(row.Name);
    if (!cin7SupplierId || !name) return [];
    const status = (text(row.Status) ?? "Active").toLowerCase();
    return [{
      cin7SupplierId,
      name,
      currency: (text(row.Currency) ?? "GBP").toUpperCase(),
      active: status === "active",
    }];
  });
}

export function parseAvailability(body: unknown) {
  const root = record(body);
  const list = listOf(root, "ProductAvailabilityList").concat(listOf(root, "ProductAvailability"));
  return list.flatMap((row) => {
    const sku = text(row.SKU) ?? text(row.Sku);
    if (!sku) return [];
    return [{
      sku,
      location: text(row.Location) ?? "",
      onHand: Math.max(num(row.OnHand ?? row.StockOnHand), 0),
      allocated: Math.max(num(row.Allocated), 0),
      available: Math.max(num(row.Available), 0),
      onOrder: Math.max(num(row.OnOrder), 0),
    }];
  });
}

function lineQty(lines: Record<string, unknown>[]) {
  const totals = new Map<string, number>();
  for (const line of lines) {
    const sku = text(line.SKU) ?? text(line.Sku);
    if (!sku) continue;
    totals.set(sku, (totals.get(sku) ?? 0) + Math.max(num(line.Quantity), 0));
  }
  return [...totals.entries()].map(([sku, qty]) => ({ sku, qty }));
}

function day(value: unknown) {
  const raw = text(value);
  if (!raw) return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(raw);
  return match?.[1] ?? null;
}

export function parseSale(body: unknown) {
  const sale = record(body);
  if (!sale) return null;
  const saleId = text(sale.ID) ?? text(sale.SaleID);
  if (!saleId) return null;
  const status = (text(sale.Status) ?? "").toUpperCase();
  const order = record(sale.Order);
  const invoices = rows(sale.Invoices);
  const lines = lineQty(rows(order?.Lines).concat(invoices.flatMap((invoice) => rows(invoice.Lines))));
  const orderedOn = day(sale.SaleOrderDate) ?? day(order?.SaleOrderDate) ?? day(invoices[0]?.InvoiceDate);
  return {
    saleId,
    status,
    orderedOn,
    lines,
    counts: SALE_DEMAND.has(status),
  };
}

export function parseSaleList(body: unknown) {
  return listOf(record(body), "SaleList").flatMap((row) => {
    const id = text(row.SaleID) ?? text(row.ID);
    return id ? [id] : [];
  });
}

export function parsePurchase(body: unknown) {
  const purchase = record(body);
  if (!purchase) return null;
  const status = (text(purchase.Status) ?? "").toUpperCase();
  const poRef = text(purchase.OrderNumber) ?? text(purchase.PurchaseOrderNumber) ?? text(record(purchase.Order)?.OrderNumber);
  if (!poRef) return null;
  if (status === "VOIDED" || status === "DRAFT") return { voided: poRef, lines: [] as PurchaseLine[] };
  if (status && !PURCHASE_KEEP.has(status)) return { voided: null, lines: [] as PurchaseLine[] };
  const order = record(purchase.Order);
  const orderedOn = day(purchase.OrderDate) ?? day(order?.Date) ?? day(order?.OrderDate);
  const received = /RECEIV|COMPLETED|INVOICED/.test(status);
  const receivedOn = received ? day(purchase.LastUpdatedDate) ?? day(purchase.ReceivedDate) ?? orderedOn : null;
  const supplierKey = text(purchase.SupplierID) ?? text(purchase.Supplier);
  const lines = lineQty(rows(order?.Lines)).map((line) => ({
    poRef,
    supplierKey,
    sku: line.sku,
    qty: line.qty,
    orderedOn,
    receivedOn,
  }));
  return { voided: null as string | null, lines };
}

type PurchaseLine = {
  poRef: string;
  supplierKey: string | null;
  sku: string;
  qty: number;
  orderedOn: string | null;
  receivedOn: string | null;
};

export function parsePurchaseList(body: unknown) {
  return listOf(record(body), "PurchaseList").flatMap((row) => {
    const id = text(row.ID) ?? text(row.PurchaseID);
    return id ? [id] : [];
  });
}
