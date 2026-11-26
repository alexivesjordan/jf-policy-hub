import { pieceOp, unitFromCode, type DutyPiece, type ParsedDuty } from "@/features/logistics/landed-cost/duty";

const THIRD_COUNTRY = "103";
const PREFERENCE = "142";
const VAT = "305";
const EXTRA = new Set(["551", "552", "553", "554", "695", "696"]);
const QUOTA = new Set(["122", "123", "143", "146"]);

const LABELS: Record<string, string> = {
  "551": "Provisional anti-dumping",
  "552": "Anti-dumping",
  "553": "Provisional countervailing",
  "554": "Countervailing",
  "695": "Additional duty",
  "696": "Safeguard",
};

type Json = Record<string, unknown>;

export type TariffMeasure = {
  measureType: string;
  areaId: string;
  start: string;
  percent: number;
  duty: ParsedDuty;
  residual: boolean;
  companySpecific: boolean;
  excluded: Set<string>;
};

export type ParsedTariff = {
  code: string;
  description: string;
  declarable: boolean;
  thirdCountry: TariffMeasure | null;
  preference: TariffMeasure | null;
  additional: TariffMeasure[];
  vatPercent: number | null;
  quotaAvailable: boolean;
  exporterSpecific: boolean;
};

function record(value: unknown): Json | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null;
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function relList(node: Json | null, name: string): Json[] {
  const value = record(node?.relationships)?.[name];
  const data = Array.isArray(value) ? value : record(value)?.data;
  if (!Array.isArray(data)) return [];
  return data.map(record).filter((item): item is Json => item !== null);
}

function relOne(node: Json | null, name: string): Json | null {
  const value = record(node?.relationships)?.[name];
  if (Array.isArray(value)) return record(value[0]) ?? null;
  const data = record(value)?.data;
  if (Array.isArray(data)) return record(data[0]) ?? null;
  return record(data);
}

function relId(node: Json | null, name: string) {
  return text(relOne(node, name)?.id);
}

export function stripHtml(value: string) {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function indexIncluded(payload: Json) {
  const included = Array.isArray(payload.included) ? payload.included : [];
  const byType = new Map<string, Map<string, Json>>();
  for (const item of included) {
    const row = record(item);
    if (!row) continue;
    const type = text(row.type);
    const id = text(row.id);
    if (!type || !id) continue;
    const bucket = byType.get(type) ?? new Map<string, Json>();
    bucket.set(id, row);
    byType.set(type, bucket);
  }
  return byType;
}

function membersOf(areaId: string, areas: Map<string, Json>, seen = new Set<string>()): Set<string> {
  if (seen.has(areaId)) return new Set();
  seen.add(areaId);
  const area = areas.get(areaId);
  const children = relList(area ?? null, "children_geographical_areas");
  if (!area || children.length === 0) {
    return areaId.length <= 3 ? new Set([areaId]) : new Set();
  }
  const out = new Set<string>();
  for (const child of children) {
    for (const member of membersOf(text(child.id), areas, seen)) out.add(member);
  }
  return out;
}

function inForce(measure: Json, asOf: string) {
  const attrs = record(measure.attributes) ?? {};
  const start = text(attrs.effective_start_date).slice(0, 10);
  const end = text(attrs.effective_end_date).slice(0, 10);
  if (start && asOf < start) return false;
  if (end && asOf > end) return false;
  return true;
}

function componentsOf(measure: Json, included: Map<string, Map<string, Json>>): DutyPiece[] {
  const refs = relList(measure, "measure_components");
  if (!refs.length) return [];
  const pieces: DutyPiece[] = [];
  refs.forEach((ref) => {
    const component = included.get("measure_component")?.get(text(ref.id));
    const attrs = record(component?.attributes) ?? {};
    const expressionId = text(attrs.duty_expression_id) || null;
    const amount = typeof attrs.duty_amount === "number" ? attrs.duty_amount : Number(attrs.duty_amount);
    if (!Number.isFinite(amount)) return;
    const monetary = text(attrs.monetary_unit_code).toUpperCase();
    const unitCode = text(attrs.measurement_unit_code);
    const op = pieceOp(expressionId, pieces.length === 0);
    if (monetary && monetary !== "GBP") {
      pieces.push({ op, kind: "specific", gbp: Number.NaN, per: "kg" });
      return;
    }
    if (monetary || unitCode) {
      const per = unitFromCode(unitCode);
      if (!per) {
        pieces.push({ op, kind: "specific", gbp: Number.NaN, per: "kg" });
        return;
      }
      pieces.push({ op, kind: "specific", gbp: amount, per });
      return;
    }
    pieces.push({ op, kind: "percent", percent: amount });
  });
  return pieces;
}

function hasComputableDuty(duty: ParsedDuty) {
  return duty.pieces.length > 0 && duty.pieces.every((piece) => (piece.kind === "percent" ? Number.isFinite(piece.percent) : Number.isFinite(piece.gbp)));
}

function percentOf(duty: ParsedDuty) {
  const percents = duty.pieces.filter((piece) => piece.kind === "percent" && piece.op === "add");
  return percents.reduce((total, piece) => total + (piece.percent ?? 0), 0);
}

function descriptionOf(data: Json, included: Map<string, Map<string, Json>>) {
  const attrs = record(data.attributes) ?? {};
  const own = stripHtml(text(attrs.description_plain) || text(attrs.formatted_description) || text(attrs.description));
  const ancestors = relList(data, "ancestors");
  const names: string[] = [];
  for (const ancestor of ancestors) {
      const item = included.get(text(ancestor.type))?.get(text(ancestor.id));
      const label = stripHtml(text(record(item?.attributes)?.description));
      if (label && !/^other$/i.test(label)) names.push(label);
  }
  if (own && !/^other$/i.test(own)) names.push(own);
  return names.slice(-2).join(" — ") || own || text(data.id);
}

function applies(measure: TariffMeasure, origin: string, membership: Map<string, Set<string>>) {
  if (measure.excluded.has(origin)) return false;
  if (measure.areaId === origin) return true;
  return membership.get(measure.areaId)?.has(origin) ?? false;
}

function specificity(areaId: string, origin: string, membership: Map<string, Set<string>>) {
  if (areaId === origin) return 0;
  if (areaId === "1011") return 1_000_000;
  return membership.get(areaId)?.size ?? 100_000;
}

function chooseThirdCountry(measures: TariffMeasure[], origin: string, membership: Map<string, Set<string>>) {
  const applicable = measures.filter((measure) => measure.measureType === THIRD_COUNTRY && applies(measure, origin, membership));
  applicable.sort((left, right) => {
    const gap = specificity(left.areaId, origin, membership) - specificity(right.areaId, origin, membership);
    if (gap !== 0) return gap;
    return right.start.localeCompare(left.start);
  });
  return applicable[0] ?? null;
}

function choosePreference(measures: TariffMeasure[], origin: string, membership: Map<string, Set<string>>, thirdPercent: number) {
  const applicable = measures.filter((measure) => measure.measureType === PREFERENCE && applies(measure, origin, membership) && measure.percent <= thirdPercent);
  applicable.sort((left, right) => left.percent - right.percent || right.start.localeCompare(left.start));
  return applicable[0] ?? null;
}

function isResidualCode(included: Map<string, Map<string, Json>>, additionalCodeId: string) {
  const code = included.get("additional_code")?.get(additionalCodeId);
  const attrs = record(code?.attributes) ?? {};
  const label = `${text(attrs.code)} ${text(attrs.description)}`.toLowerCase();
  return /residual|all other/.test(label) || /999$/.test(text(attrs.code));
}

function chooseAdditional(measures: TariffMeasure[]) {
  const chosen: TariffMeasure[] = [];
  let exporterSpecific = false;
  const types = [...EXTRA].filter((type) => measures.some((measure) => measure.measureType === type));
  const definitiveWins = new Set<string>();
  if (types.includes("552")) definitiveWins.add("551");
  if (types.includes("554")) definitiveWins.add("553");
  for (const type of types) {
    if (definitiveWins.has(type)) continue;
    const group = measures.filter((measure) => measure.measureType === type);
    const residual = group.filter((measure) => measure.residual);
    const general = group.filter((measure) => !measure.companySpecific);
    const pool = residual.length ? residual : general;
    if (!pool.length) {
      if (group.length) exporterSpecific = true;
      continue;
    }
    pool.sort((left, right) => right.start.localeCompare(left.start));
    const pick = pool[0];
    if (pick) chosen.push({ ...pick, residual: residual.length > 0 });
  }
  return { chosen, exporterSpecific };
}

export function parseCommodity(payload: unknown, origin: string, asOf: string): ParsedTariff {
  const root = record(payload);
  const data = record(root?.data);
  if (!root || !data) throw new Error("The UK Trade Tariff returned an unreadable commodity.");
  const country = origin.trim().toUpperCase();
  const included = indexIncluded(root);
  const areas = included.get("geographical_area") ?? new Map<string, Json>();
  const membership = new Map<string, Set<string>>();
  for (const areaId of areas.keys()) membership.set(areaId, membersOf(areaId, areas));

  const importRefs = relList(data, "import_measures");
  const measures: TariffMeasure[] = [];
  let quotaAvailable = false;
  for (const ref of importRefs) {
      const measure = included.get("measure")?.get(text(ref.id));
      if (!measure) continue;
      const attrs = record(measure.attributes) ?? {};
      if (attrs.import === false) continue;
      if (!inForce(measure, asOf)) continue;
      const measureType = relId(measure, "measure_type");
      const areaId = relId(measure, "geographical_area");
      if (QUOTA.has(measureType) && (membership.get(areaId)?.has(country) || areaId === country)) quotaAvailable = true;
      if (measureType !== THIRD_COUNTRY && measureType !== PREFERENCE && measureType !== VAT && !EXTRA.has(measureType)) continue;
      const order = relOne(measure, "order_number");
      if (order) continue;
      const duty = { pieces: componentsOf(measure, included) };
      if (!hasComputableDuty(duty)) continue;
      const excluded = new Set<string>(relList(measure, "excluded_countries").map((item) => text(item.id)).filter(Boolean));
      const additionalCodeId = relId(measure, "additional_code");
      const residual = Boolean(additionalCodeId) && isResidualCode(included, additionalCodeId);
      const companySpecific = Boolean(additionalCodeId) && !residual;
      measures.push({
        measureType,
        areaId,
        start: text(attrs.effective_start_date),
        percent: percentOf(duty),
        duty,
        residual,
        companySpecific,
        excluded,
      });
  }

  const thirdCountry = chooseThirdCountry(measures, country, membership);
  const preference = thirdCountry ? choosePreference(measures, country, membership, thirdCountry.percent) : null;
  const vat = measures
    .filter((measure) => measure.measureType === VAT && applies(measure, country, membership))
    .sort((left, right) => specificity(left.areaId, country, membership) - specificity(right.areaId, country, membership) || right.start.localeCompare(left.start))[0] ?? null;
  const extra = chooseAdditional(measures.filter((measure) => EXTRA.has(measure.measureType) && applies(measure, country, membership)));
  const attrs = record(data.attributes) ?? {};
  return {
    code: text(attrs.goods_nomenclature_item_id) || text(data.id),
    description: descriptionOf(data, included),
    declarable: attrs.declarable !== false,
    thirdCountry,
    preference,
    additional: extra.chosen,
    vatPercent: vat ? vat.percent : null,
    quotaAvailable,
    exporterSpecific: extra.exporterSpecific,
  };
}

export function dutyLabel(measureType: string, residual: boolean) {
  const label = LABELS[measureType] ?? "Additional duty";
  return residual ? `${label} · residual` : label;
}

export function parseSearch(payload: unknown) {
  const root = record(payload);
  const data = record(root?.data);
  const match = record(record(data?.attributes)?.goods_nomenclature_match);
  const commodities = Array.isArray(match?.commodities) ? match.commodities : [];
  const items: { code: string; description: string }[] = [];
  for (const hit of commodities) {
    const source = record(record(hit)?._source);
    if (!source || source.declarable === false) continue;
    const code = text(source.goods_nomenclature_item_id).replace(/\D/g, "").slice(0, 10);
    const description = stripHtml(text(source.description));
    if (code.length < 10 || !description) continue;
    items.push({ code, description });
    if (items.length === 20) break;
  }
  return items;
}
