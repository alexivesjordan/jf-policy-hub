import { normaliseHsCode } from "@/features/logistics/commercial-invoice/rules";
import { resolveCin7LineNets } from "@/lib/cin7/line-nets";
import { iso2FromIso3 } from "@/lib/iso3166";

export type PurchaseGet = (path: "purchase" | "purchaseList" | "product", query: Record<string, string>) => Promise<unknown>;

export type PurchaseLine = {
  sku: string | null;
  description: string;
  quantity: number;
  value: number | null;
  hsCode: string | null;
  originCountry: string | null;
  unitWeightKg: number | null;
};

export type PurchaseOrder = {
  id: string;
  number: string;
  supplier: string | null;
  currency: string | null;
  lines: PurchaseLine[];
};

const ORDER_NUMBER = /^[A-Za-z0-9-]{1,40}$/;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function list(value: unknown) {
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

function productsOf(body: unknown) {
  const root = record(body);
  if (!root) return [];
  const products = list(root.Products);
  if (products.length > 0) return products;
  return text(root.SKU) || text(root.ID) ? [root] : [];
}

function isoCountry(value: string | null) {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^[A-Za-z]{2}$/.test(trimmed)) return trimmed.toUpperCase() === "EL" ? "GR" : trimmed.toUpperCase();
  if (/^[A-Za-z]{3}$/.test(trimmed)) return iso2FromIso3(trimmed);
  if (trimmed.toLowerCase() === "china") return "CN";
  if (trimmed.toLowerCase() === "united kingdom" || trimmed.toLowerCase() === "uk") return "GB";
  return null;
}

function weightKg(product: Record<string, unknown>) {
  const units = text(product.WeightUnits)?.toLowerCase();
  if (units && units !== "kg" && units !== "kilogram" && units !== "kilograms") return null;
  const weight = amount(product.Weight);
  if (weight == null || weight <= 0) return null;
  return weight;
}

async function findPurchase(orderNumber: string, get: PurchaseGet) {
  for (let page = 1; page <= 3; page += 1) {
    const body = record(await get("purchaseList", { Search: orderNumber, Page: String(page), Limit: "100" }));
    const rows = list(body?.PurchaseList);
    const exact = rows.filter((row) => text(row.OrderNumber)?.toLowerCase() === orderNumber.toLowerCase());
    if (exact.length > 1) throw new Error("More than one Cin7 purchase has that order number.");
    if (exact.length === 1) return exact[0];
    const total = amount(body?.Total) ?? rows.length;
    if (rows.length === 0 || page * 100 >= total) return null;
  }
  return null;
}

/** GET a purchase order and the product customs fields already used on a commercial invoice. */
export async function readPurchase(orderNumberOrId: string, get: PurchaseGet): Promise<PurchaseOrder | null> {
  const lookup = orderNumberOrId.trim();
  if (!lookup) return null;
  let purchase: Record<string, unknown> | null = null;
  let listed: Record<string, unknown> | null = null;
  if (GUID.test(lookup)) {
    purchase = record(await get("purchase", { ID: lookup }));
  } else {
    if (!ORDER_NUMBER.test(lookup)) throw new Error("Enter an order number such as PO-00123.");
    listed = await findPurchase(lookup, get);
    const id = listed ? text(listed.ID) : null;
    if (!id) return null;
    purchase = record(await get("purchase", { ID: id }));
  }
  if (!purchase || !text(purchase.ID)) return null;
  const status = text(purchase.Status) ?? text(listed?.Status);
  if (status && /void/i.test(status)) throw new Error("That purchase is void.");

  const order = record(purchase.Order);
  const invoice = record(purchase.Invoice);
  const source = list(order?.Lines).length ? order : invoice;
  const rawLines = list(source?.Lines).filter((line) => (amount(line.Quantity) ?? 0) > 0);
  const money = resolveCin7LineNets(
    rawLines.map((line) => ({ total: amount(line.Total), tax: amount(line.Tax) })),
    [],
    { beforeTax: amount(source?.TotalBeforeTax), includingTax: amount(source?.Total) },
  );

  const products = new Map<string, Record<string, unknown>>();
  const jobs = rawLines.flatMap((line) => {
    const productId = text(line.ProductID);
    const sku = text(line.SKU);
    const key = productId ?? sku;
    if (!key || products.has(key)) return [];
    products.set(key, {});
    const query: Record<string, string> = { Limit: "1", IncludeDeprecated: "true" };
    if (productId) query.ID = productId;
    else if (sku) query.Sku = sku;
    return [{ key, query }];
  });
  let cursor = 0;
  async function loadProduct() {
    for (;;) {
      const index = cursor;
      cursor += 1;
      const job = jobs[index];
      if (!job) return;
      products.set(job.key, productsOf(await get("product", job.query))[0] ?? {});
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, jobs.length) }, () => loadProduct()));

  return {
    id: text(purchase.ID) ?? "",
    number: text(purchase.OrderNumber) ?? text(listed?.OrderNumber) ?? lookup,
    supplier: text(purchase.Supplier) ?? text(listed?.Supplier),
    currency: text(purchase.SupplierCurrency) ?? text(listed?.SupplierCurrency) ?? text(purchase.BaseCurrency) ?? text(listed?.BaseCurrency),
    lines: rawLines.map((line, index) => {
      const productId = text(line.ProductID);
      const sku = text(line.SKU);
      const product = products.get(productId ?? sku ?? "") ?? {};
      const hs = text(product.HSCode);
      return {
        sku: text(product.SKU) ?? sku,
        description: text(line.Name) ?? text(product.Name) ?? sku ?? "Item",
        quantity: amount(line.Quantity) ?? 0,
        value: money.lineNets[index] ?? null,
        hsCode: hs ? normaliseHsCode(hs) : null,
        originCountry: isoCountry(text(product.CountryOfOriginCode)) ?? isoCountry(text(product.CountryOfOrigin)),
        unitWeightKg: weightKg(product),
      };
    }),
  };
}
