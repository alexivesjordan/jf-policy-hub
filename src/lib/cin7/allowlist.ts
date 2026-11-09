/** Cin7 Core reads pricing is allowed to make. Anything else throws before fetch. */
export const CIN7_BASE_URL = "https://inventory.dearsystems.com/ExternalApi/v2";

export const CIN7_ALLOWED_PATHS = ["sale", "saleList", "product", "customer"] as const;

export type Cin7AllowedPath = (typeof CIN7_ALLOWED_PATHS)[number];

const QUERY_KEYS: Record<Cin7AllowedPath, readonly string[]> = {
  sale: ["ID"],
  saleList: ["Search", "Page", "Limit"],
  product: ["ID", "Sku", "Limit"],
  customer: ["ID", "Limit"],
};

export class Cin7RequestBlocked extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Cin7RequestBlocked";
  }
}

export function assertCin7Get(method: string, path: string, query: Record<string, string> = {}) {
  const verb = method.trim().toUpperCase();
  if (verb !== "GET") {
    throw new Cin7RequestBlocked(`Cin7 blocked ${verb || "request"}. Only GET is allowed.`);
  }

  const raw = path.trim();
  if (raw.includes("?") || raw.includes("#") || raw.includes("\\") || raw.includes("..") || /%2e|%2f/i.test(raw)) {
    throw new Cin7RequestBlocked("Cin7 blocked that path.");
  }
  const name = raw.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!CIN7_ALLOWED_PATHS.includes(name as Cin7AllowedPath) || name.includes("/")) {
    throw new Cin7RequestBlocked(`Cin7 blocked path "${name || "/"}".`);
  }

  const allowed = QUERY_KEYS[name as Cin7AllowedPath];
  for (const key of Object.keys(query)) {
    if (!allowed.includes(key)) {
      throw new Cin7RequestBlocked(`Cin7 blocked query "${key}" on ${name}.`);
    }
  }
  if (name === "sale" && !query.ID) throw new Cin7RequestBlocked("Cin7 sale requires a SaleID.");
  if (name === "saleList" && !query.Search) throw new Cin7RequestBlocked("Cin7 saleList requires an order number search.");
  if (name === "product" && !query.ID && !query.Sku) throw new Cin7RequestBlocked("Cin7 product requires an ID or SKU.");
  if (name === "product" && query.ID && query.Sku) throw new Cin7RequestBlocked("Cin7 product accepts an ID or a SKU, not both.");
  if (name === "customer" && !query.ID) throw new Cin7RequestBlocked("Cin7 customer requires an ID.");

  return { path: name as Cin7AllowedPath, query };
}
