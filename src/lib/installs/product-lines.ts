/** Maintenance guides attached to a finished visit, chosen from the order lines. */
export const MAINTENANCE_DOCS = ["elite_strength", "performance_strength", "cardio"] as const;
export type MaintenanceDoc = (typeof MAINTENANCE_DOCS)[number];

export const VISIT_DOCUMENTS = ["catalogue", ...MAINTENANCE_DOCS] as const;
export type VisitDocumentKey = (typeof VISIT_DOCUMENTS)[number];

export type OrderLine = {
  sku?: string | null;
  productName?: string | null;
  description?: string | null;
  productLine?: string | null;
  category?: string | null;
};

export const DOCUMENT_LABELS: Record<VisitDocumentKey, string> = {
  catalogue: "Jordan Fitness catalogue",
  elite_strength: "Elite strength maintenance",
  performance_strength: "Performance strength maintenance",
  cardio: "Cardio maintenance",
};

export const DOCUMENT_FILENAMES: Record<VisitDocumentKey, string> = {
  catalogue: "Jordan-Fitness-catalogue.pdf",
  elite_strength: "Elite-strength-maintenance.pdf",
  performance_strength: "Performance-strength-maintenance.pdf",
  cardio: "Cardio-maintenance.pdf",
};

const CARDIO_PRODUCT = /treadmill|elliptical|cross[\s-]?trainer|exercise bike|spin bike|recumbent|upright bike|rower|rowing|skierg|bikeerg|concept\s*2|stepper|\bcardio\b/;
const PERFORMANCE = /performance\s+strength|performance\s+series|\bdhz\b/;
const ELITE_STRENGTH = /elite\s+strength|elite\s+series|jordan\s+elite/;
const ELITE_WORD = /\belite\b/;
const STRENGTH_GEAR = /bench|rack|cable|pulldown|press|squat|leg|machine|strength|\blat\b|\brow\b|shoulder|chest|functional trainer/;
const NON_EQUIPMENT = /\b(delivery|install|installation|carriage|freight|vat|recycling|packaging removal|labour|labor)\b/;

function textOf(line: OrderLine) {
  return [line.productLine, line.productName, line.description, line.sku, line.category].filter(Boolean).join(" ").toLowerCase();
}

function explicitRange(productLine: string | null | undefined): MaintenanceDoc | null {
  const value = (productLine ?? "").trim().toLowerCase();
  if (!value) return null;
  if (value.includes("cardio")) return "cardio";
  if (value.includes("performance") || value.includes("dhz")) return "performance_strength";
  if (value.includes("elite")) return "elite_strength";
  return null;
}

/** One order line maps to at most one maintenance guide. Unknown equipment maps to none. */
export function maintenanceDocForLine(line: OrderLine): MaintenanceDoc | null {
  const text = textOf(line);
  if (!text.trim()) return null;

  const named = explicitRange(line.productLine);
  if (named === "cardio" || named === "performance_strength") return named;
  if (named === "elite_strength") return CARDIO_PRODUCT.test(text) ? "cardio" : "elite_strength";

  const looksLikeEquipment =
    !NON_EQUIPMENT.test(text) || CARDIO_PRODUCT.test(text) || STRENGTH_GEAR.test(text) || PERFORMANCE.test(text) || ELITE_WORD.test(text);
  if (!looksLikeEquipment) return null;

  if (CARDIO_PRODUCT.test(text) && !PERFORMANCE.test(text)) return "cardio";
  if (PERFORMANCE.test(text)) return "performance_strength";
  if (ELITE_STRENGTH.test(text) && !CARDIO_PRODUCT.test(text)) return "elite_strength";
  if (ELITE_WORD.test(text) && STRENGTH_GEAR.test(text) && !CARDIO_PRODUCT.test(text)) return "elite_strength";

  const category = (line.category ?? "").trim().toLowerCase();
  if (category === "cardio" || category === "treadmills" || category === "bikes" || category === "rowers" || category === "ski machines") {
    return "cardio";
  }
  return null;
}

export function maintenanceDocsForLines(lines: readonly OrderLine[]): MaintenanceDoc[] {
  const found = new Set<MaintenanceDoc>();
  for (const line of lines) {
    const doc = maintenanceDocForLine(line);
    if (doc) found.add(doc);
  }
  return MAINTENANCE_DOCS.filter((doc) => found.has(doc));
}

/** Catalogue goes with every pack. Maintenance guides only when the order names that range. */
export function documentsForOrder(lines: readonly OrderLine[]): VisitDocumentKey[] {
  return ["catalogue", ...maintenanceDocsForLines(lines)];
}

export function selectStoredDocuments(wanted: readonly VisitDocumentKey[], stored: readonly VisitDocumentKey[]) {
  const have = new Set(stored);
  return {
    attach: wanted.filter((key) => have.has(key)),
    skipped: wanted.filter((key) => !have.has(key)),
  };
}
