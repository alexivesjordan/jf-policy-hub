/** Read a GET /product body. Street and contact fields are not part of a product. */

export type Cin7ProductHit = {
  sku: string;
  productId: string | null;
  category: string | null;
  name: string;
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function productHit(body: unknown): Cin7ProductHit | null {
  const root = record(body);
  const listed = Array.isArray(root?.Products) ? root.Products.map(record).find((item) => item !== null) : null;
  const product = listed ?? (text(root?.SKU) || text(root?.ID) ? root : null);
  if (!product) return null;
  const sku = text(product.SKU);
  if (!sku) return null;
  return {
    sku,
    productId: text(product.ID),
    category: text(product.Category),
    name: text(product.Name) ?? sku,
  };
}

export async function fillMissingSkuCategories<T extends { sku: string; productId: string; category: string }>(
  lines: T[],
  knownSkus: Set<string>,
  lookup: (productId: string) => Promise<unknown>,
): Promise<{ lines: T[]; found: Cin7ProductHit[] }> {
  const found: Cin7ProductHit[] = [];
  const byId = new Map<string, Cin7ProductHit | null>();
  const next = [];
  for (const line of lines) {
    if (!line.sku || knownSkus.has(line.sku) || !line.productId) {
      next.push(line);
      continue;
    }
    if (!byId.has(line.productId)) {
      try {
        byId.set(line.productId, productHit(await lookup(line.productId)));
      } catch {
        byId.set(line.productId, null);
      }
    }
    const hit = byId.get(line.productId) ?? null;
    if (hit) found.push(hit);
    next.push(hit?.category ? { ...line, category: hit.category } : line);
  }
  return { lines: next, found };
}
