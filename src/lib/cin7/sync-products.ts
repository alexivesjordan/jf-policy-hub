import "server-only";

import { cin7Get } from "@/lib/cin7/transport";

export type SkuSyncRow = {
  sku: string;
  product_name: string;
  cin7_category: string | null;
  cin7_product_id: string | null;
  cin7_uom: string | null;
};

type SyncTarget = {
  upsert(rows: SkuSyncRow[]): Promise<void>;
};

const PAGE_SIZE = 500;
const MAX_PAGES = 20;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Page through every product, including deprecated. Does not log payloads.
 * About 4,580 products at 500 per page is 10 GET /product calls, inside the 60/min limit.
 */
export async function syncCin7Products(target: SyncTarget) {
  const accountId = process.env.CIN7_ACCOUNT_ID?.trim() ?? "";
  const applicationKey = process.env.CIN7_APPLICATION_KEY?.trim() ?? "";
  if (!accountId || !applicationKey) {
    return { ok: false as const, message: "Live orders are not connected yet.", products: 0, pages: 0 };
  }

  let page = 1;
  let total = Number.POSITIVE_INFINITY;
  let products = 0;
  let pages = 0;

  while (page <= MAX_PAGES && (page - 1) * PAGE_SIZE < total) {
    const body = await cin7Get({
      accountId,
      applicationKey,
      path: "product",
      query: { Page: String(page), Limit: String(PAGE_SIZE), IncludeDeprecated: "true" },
    });
    pages += 1;
    const root = record(body);
    const list = Array.isArray(root?.Products) ? root.Products : [];
    const reported = root?.Total;
    if (typeof reported === "number" && Number.isFinite(reported)) total = reported;
    const rows: SkuSyncRow[] = [];
    for (const item of list) {
      const product = record(item);
      if (!product) continue;
      const sku = text(product.SKU);
      if (!sku) continue;
      rows.push({
        sku,
        product_name: text(product.Name) ?? sku,
        cin7_category: text(product.Category),
        cin7_product_id: text(product.ID),
        cin7_uom: text(product.UOM),
      });
    }
    if (rows.length > 0) {
      for (let index = 0; index < rows.length; index += 200) {
        await target.upsert(rows.slice(index, index + 200));
      }
    }
    products += rows.length;
    if (list.length === 0) break;
    page += 1;
  }

  return {
    ok: true as const,
    message: `Synced ${products} products in ${pages} pages.`,
    products,
    pages,
  };
}
