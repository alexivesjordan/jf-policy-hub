import { resolveCin7LineNets } from "@/lib/cin7/line-nets";
import { tilesPerPackFromProduct } from "@/lib/pricer/flooring";
import { normaliseUkPostcode } from "@/lib/quotes/postcode";
import type { Cin7Quote, Cin7QuoteLine } from "@/lib/cin7/types";

export type Cin7Getter = (path: "sale" | "saleList" | "product" | "customer", query: Record<string, string>) => Promise<unknown>;

const ORDER_NUMBER = /^[A-Za-z0-9-]{1,40}$/;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

function saleId(row: Record<string, unknown>) {
  return text(row.SaleID) ?? text(row.ID);
}

function weightKg(product: Record<string, unknown>) {
  const units = text(product.WeightUnits)?.toLowerCase();
  if (units && units !== "kg" && units !== "kilogram" && units !== "kilograms") return null;
  const weight = amount(product.Weight);
  if (weight == null || weight <= 0) return null;
  return weight;
}

function customerAddress(customer: Record<string, unknown> | null) {
  const addresses = list(customer?.Addresses);
  const shipping = addresses.filter((address) => text(address.Type) === "Shipping");
  const billing = addresses.filter((address) => text(address.Type) === "Billing");
  return (
    shipping.find((address) => address.DefaultForType === true) ??
    shipping[0] ??
    billing.find((address) => address.DefaultForType === true) ??
    billing[0] ??
    null
  );
}

function shippingPostcode(customer: Record<string, unknown> | null, sale: Record<string, unknown>) {
  const raw = text(customerAddress(customer)?.Postcode) ?? text(record(sale.ShippingAddress)?.Postcode);
  return raw ? normaliseUkPostcode(raw) : null;
}

function addressLines(address: Record<string, unknown> | null) {
  if (!address) return null;
  const parts = [text(address.Line1), text(address.Line2), text(address.City), text(address.Postcode)].filter(
    (part): part is string => Boolean(part),
  );
  return parts.length ? parts.join(", ") : null;
}

function orderDocument(sale: Record<string, unknown>) {
  const order = record(sale.Order);
  const orderLines = list(order?.Lines);
  const source = orderLines.length > 0 ? order : record(sale.Quote);
  return {
    document: source,
    lines: list(source?.Lines),
    charges: list(source?.AdditionalCharges),
    fromQuote: orderLines.length === 0,
  };
}

function productsOf(body: unknown) {
  const root = record(body);
  if (!root) return [];
  const products = list(root.Products);
  if (products.length > 0) return products;
  return text(root.SKU) || text(root.ID) ? [root] : [];
}

function customerOf(body: unknown) {
  const root = record(body);
  if (!root) return null;
  const listed = list(root.CustomerList);
  if (listed.length > 0) return listed[0];
  return list(root.Addresses).length > 0 || text(root.ID) ? root : null;
}

/**
 * Sale list, one sale, its products, and the customer shipping postcode.
 * Phone, email, and street lines are not copied onto the quote.
 */
export async function readCin7Sale(orderNumberOrId: string, get: Cin7Getter): Promise<Cin7Quote | null> {
  const lookup = orderNumberOrId.trim();
  if (!lookup) return null;

  let sale: Record<string, unknown> | null = null;
  let listed: Record<string, unknown> | null = null;
  if (GUID.test(lookup)) {
    sale = record(await get("sale", { ID: lookup }));
  } else {
    if (!ORDER_NUMBER.test(lookup)) throw new Error("Enter an order number such as SO-00490.");
    listed = await findSale(lookup, get);
    if (!listed) return null;
    const id = saleId(listed);
    if (!id) return null;
    sale = record(await get("sale", { ID: id }));
  }
  if (!sale || !saleId(sale)) return null;

  const { document, lines, charges, fromQuote } = orderDocument(sale);
  const priced = lines.filter((line) => (amount(line.Quantity) ?? 0) > 0);
  const pricedCharges = charges.filter((charge) => (amount(charge.Quantity) ?? 1) > 0);
  const money = resolveCin7LineNets(
    priced.map((line) => ({ total: amount(line.Total), tax: amount(line.Tax) })),
    pricedCharges.map((charge) => ({
      description: text(charge.Description) ?? "Additional charge",
      total: amount(charge.Total),
      tax: amount(charge.Tax),
    })),
    { beforeTax: amount(document?.TotalBeforeTax), includingTax: amount(document?.Total) },
  );
  const products = new Map<string, Record<string, unknown>>();
  for (const line of priced) {
    const productId = text(line.ProductID);
    const sku = text(line.SKU);
    const key = productId ?? sku;
    if (!key || products.has(key)) continue;
    const query: Record<string, string> = { Limit: "1", IncludeDeprecated: "true" };
    if (productId) query.ID = productId;
    else if (sku) query.Sku = sku;
    products.set(key, productsOf(await get("product", query))[0] ?? {});
  }

  const customerId = text(sale.CustomerID) ?? text(listed?.CustomerID);
  const customer = customerId ? customerOf(await get("customer", { ID: customerId, Limit: "1" })) : null;
  const quoteLines: Cin7QuoteLine[] = priced.map((line, index) => {
    const productId = text(line.ProductID);
    const sku = text(line.SKU);
    const product = products.get(productId ?? sku ?? "") ?? {};
    return {
      sku: text(product.SKU) ?? sku,
      productName: text(line.Name) ?? text(product.Name) ?? sku ?? "Item",
      category: null,
      cin7Category: text(product.Category),
      productId,
      qty: amount(line.Quantity) ?? 0,
      lineNet: money.lineNets[index] ?? null,
      unitWeightKg: weightKg(product),
      length: amount(product.Length),
      width: amount(product.Width),
      height: amount(product.Height),
      dimensionUnit: text(product.DimensionsUnits),
      uom: text(product.UOM),
      tilesPerPack: tilesPerPackFromProduct(product),
    };
  });

  const number = text(record(sale.Order)?.SaleOrderNumber) ?? text(listed?.OrderNumber) ?? lookup;
  return {
    id: saleId(sale) as string,
    number,
    customerName: text(sale.Customer) ?? text(customer?.Name) ?? "",
    customerRef: text(sale.CustomerReference) ?? text(listed?.CustomerReference) ?? "",
    segment: null,
    customerType: null,
    postcode: shippingPostcode(customer, sale),
    customerId,
    lines: quoteLines,
    additionalCharges: money.charges,
    usedQuoteLines: fromQuote && quoteLines.length > 0,
    taxStripped: money.taxStripped,
    moneyFlags: money.flags,
    weightIgnored: priced.some((line) => {
      const product = products.get(text(line.ProductID) ?? text(line.SKU) ?? "");
      const raw = product ? amount(product.Weight) : null;
      return product != null && weightKg(product) == null && raw != null && raw > 0;
    }),
  };
}

/** Site address and contact for the install record. Not copied onto the priced quote. */
export async function readCin7BookingDetails(orderNumberOrId: string, get: Cin7Getter) {
  const lookup = orderNumberOrId.trim();
  if (!lookup) return null;
  let sale: Record<string, unknown> | null = null;
  if (GUID.test(lookup)) {
    sale = record(await get("sale", { ID: lookup }));
  } else {
    if (!ORDER_NUMBER.test(lookup)) return null;
    const listed = await findSale(lookup, get);
    const id = listed ? saleId(listed) : null;
    if (!id) return null;
    sale = record(await get("sale", { ID: id }));
  }
  if (!sale) return null;
  const customerId = text(sale.CustomerID);
  const customer = customerId ? customerOf(await get("customer", { ID: customerId, Limit: "1" })) : null;
  return {
    siteAddress: addressLines(customerAddress(customer) ?? record(sale.ShippingAddress)),
    contactName: text(sale.Contact) ?? text(customer?.Name),
    contactEmail: text(sale.Email) ?? text(customer?.Email),
    contactPhone: text(sale.Phone) ?? text(customer?.Phone),
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
