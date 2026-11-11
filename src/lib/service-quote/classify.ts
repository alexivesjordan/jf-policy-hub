import { isServiceCategory, type ServiceCategory } from "./rates";

export type ClassificationRule = {
  matchKind: "sku" | "description_contains" | "category_name";
  matchValue: string;
  category: ServiceCategory;
  priority: number;
};

export type ClassifiedLine = {
  category: ServiceCategory;
  reasons: string[];
};

const REASONS: Partial<Record<ServiceCategory, string>> = {
  unresolved_dhz: "The line does not name a model. It is priced as one provisional DHZ machine and is not covered until it is identified.",
  unknown_product: "The product cannot be classified from the SKU or description, so it is left out of the automatic price.",
  jordan_cardio_unverified: "The cardio model or OEM is not confirmed, so the warranty allowance is provisional.",
  other_cardio_unverified: "This looks like third-party cardio. Maintenance is priced; the five-year extension is not.",
  cable_or_power_rack: "Rack and trainer component cover is provisional until the model is confirmed.",
  concept2_cardio: "Concept2 is maintained under PM and stays on the manufacturer warranty.",
};

function norm(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function fromRules(
  input: { sku?: string | null; description: string; cin7Category?: string | null },
  rules: ClassificationRule[],
): ServiceCategory | null {
  const sku = norm(input.sku);
  const description = norm(input.description);
  const categoryName = norm(input.cin7Category);
  const ranked = [...rules].sort((a, b) => a.priority - b.priority);
  for (const rule of ranked) {
    if (!isServiceCategory(rule.category)) continue;
    const needle = norm(rule.matchValue);
    if (!needle) continue;
    if (rule.matchKind === "sku" && sku === needle) return rule.category;
    if (rule.matchKind === "description_contains" && description.includes(needle)) return rule.category;
    if (rule.matchKind === "category_name" && categoryName === needle) return rule.category;
  }
  return null;
}

/** Deterministic fallback when no owner mapping matches. */
export function classifyByText(description: string, sku = ""): ServiceCategory {
  const text = `${sku} ${description}`.toLowerCase();
  if (/\b(delivery|install|installation|carriage|freight|vat|recycling|packaging removal)\b/.test(text)) return "delivery_install";
  if (/\bfloor(ing)?\b/.test(text)) return "flooring";
  if (/concept\s*2|rower?g|skierg|bikeerg/.test(text)) return "concept2_cardio";
  if (/miscellaneous dhz|add description|missing model|unidentified dhz/.test(text)) return "unresolved_dhz";
  if (/\bdhz\b/.test(text) && /misc|unspecified|unknown|item missing/.test(text)) return "unresolved_dhz";
  if (/dumbbell stand|kettlebell rack|storage rack|plate tree|barbell rack/.test(text)) return "storage_rack";
  if (/dumbbell|kettlebell|plate|collar|band|medicine ball|mat\b|rope\b|loose weight|accessory/.test(text)) return "loose_accessory";
  if (/bench/.test(text)) return "adjustable_bench";
  if (/cable rack|power rack|functional trainer|\bj75\b/.test(text)) return "cable_or_power_rack";
  if (/air\s*bike/.test(text)) return "jordan_cardio_unverified";
  if (/spin bike|performance spin/.test(text)) return "other_cardio_unverified";
  if (/treadmill|elliptical|recumbent|upright bike|stepper|cardio bike/.test(text)) return "jordan_cardio";
  if (/pin-loaded|plate-loaded|selectoris|leg press|strength machine/.test(text)) return "strength_machine";
  return "unknown_product";
}

export function classifyLine(
  input: { sku?: string | null; description: string; cin7Category?: string | null },
  rules: ClassificationRule[] = [],
): ClassifiedLine {
  const category = fromRules(input, rules) ?? classifyByText(input.description, input.sku ?? "");
  const reason = REASONS[category];
  return { category, reasons: reason ? [reason] : [] };
}
