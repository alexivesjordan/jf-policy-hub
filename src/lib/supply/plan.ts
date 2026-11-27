/** Demand classification, forecast, and reorder maths. Days in a month are 30. */

export const DAYS_PER_MONTH = 30;
export const ADI_CUTOFF = 1.32;
export const CV2_CUTOFF = 0.49;

export type DemandClass = "smooth" | "erratic" | "intermittent" | "lumpy" | "insufficient";
export type ForecastMethod = "sma" | "sba" | "seasonal_sma" | "seasonal_sba";

export type DemandPoint = {
  month: string;
  qty: number;
  source: "cin7" | "orderwise";
};

export type PlanInput = {
  /** Oldest month first, zeros included. */
  monthly: number[];
  /** Calendar month of monthly[0], 0 = January. */
  startMonth: number;
  leadTimeDays: number;
  reviewDays: number;
  /** Null uses a service-level safety stock. Zero means no extra days. */
  safetyDays: number | null;
  serviceLevel: number;
  moq: number;
  orderMultiple: number;
  available: number;
  onOrder: number;
  onHand: number;
  smaWindow: number;
  crostonAlpha: number;
  forecastMonths: number;
};

export type Plan = {
  classification: DemandClass;
  method: ForecastMethod;
  level: number;
  forecasts: number[];
  leadTimeDemand: number;
  safetyStock: number;
  reorderPoint: number;
  orderUpTo: number;
  suggestedQty: number;
  zeroStock: boolean;
  belowReorder: boolean;
  overstock: boolean;
  reason: string;
};

export function classifyDemand(series: number[]) {
  const positives = series.filter((qty) => qty > 0);
  if (series.length === 0 || positives.length === 0) {
    return { klass: "insufficient" as const, adi: null, cv2: null };
  }
  const adi = series.length / positives.length;
  let cv2 = 0;
  if (positives.length >= 2) {
    const mean = positives.reduce((sum, qty) => sum + qty, 0) / positives.length;
    const variance = positives.reduce((sum, qty) => sum + (qty - mean) ** 2, 0) / (positives.length - 1);
    cv2 = mean === 0 ? 0 : variance / (mean * mean);
  }
  const klass: DemandClass =
    adi < ADI_CUTOFF && cv2 < CV2_CUTOFF ? "smooth" : adi < ADI_CUTOFF ? "erratic" : cv2 < CV2_CUTOFF ? "intermittent" : "lumpy";
  return { klass, adi, cv2 };
}

export function simpleMovingAverage(series: number[], window: number) {
  const width = Math.max(1, Math.floor(window));
  const slice = series.slice(-width);
  if (slice.length === 0) return 0;
  return slice.reduce((sum, qty) => sum + qty, 0) / slice.length;
}

/**
 * Syntetos-Boylan approximation.
 * The first demand sets size and the interval from the start of the series.
 * Later demands smooth size and the gap since the previous demand.
 */
export function crostonSba(series: number[], alpha: number) {
  let size = 0;
  let interval = 0;
  let last = -1;
  let started = false;
  for (let index = 0; index < series.length; index += 1) {
    const qty = series[index] ?? 0;
    if (qty <= 0) continue;
    if (!started) {
      size = qty;
      interval = index + 1;
      started = true;
    } else {
      const gap = index - last;
      size = size + alpha * (qty - size);
      interval = interval + alpha * (gap - interval);
    }
    last = index;
  }
  if (!started || interval === 0) return 0;
  return (1 - alpha / 2) * (size / interval);
}

/** Classical multiplicative indices, aligned to series position mod 12. Null under 24 months. */
export function seasonalIndices(series: number[]) {
  if (series.length < 24) return null;
  const buckets: number[][] = Array.from({ length: 12 }, () => []);
  for (let t = 6; t <= series.length - 7; t += 1) {
    let total = 0.5 * (series[t - 6] ?? 0) + 0.5 * (series[t + 6] ?? 0);
    for (let k = t - 5; k <= t + 5; k += 1) total += series[k] ?? 0;
    const centre = total / 12;
    if (centre > 0) buckets[t % 12]?.push((series[t] ?? 0) / centre);
  }
  const raw = buckets.map((list) => (list.length === 0 ? 1 : list.reduce((sum, value) => sum + value, 0) / list.length));
  const mean = raw.reduce((sum, value) => sum + value, 0) / 12;
  if (mean === 0) return raw.map(() => 1);
  return raw.map((value) => value / mean);
}

/** Inverse standard normal, Acklam's rational approximation. */
export function zForServiceLevel(level: number) {
  const p = Math.min(0.999, Math.max(0.501, level));
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const plow = 0.02425;
  const phigh = 1 - plow;
  let q: number;
  if (p < plow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > phigh) {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  q = p - 0.5;
  const r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

export function roundOrderQty(qty: number, moq: number, multiple: number) {
  if (!(qty > 0)) return 0;
  let rounded = Math.ceil(qty - 1e-9);
  const minimum = moq > 0 ? Math.ceil(moq - 1e-9) : 0;
  if (minimum > 0 && rounded < minimum) rounded = minimum;
  if (multiple > 0) {
    rounded = Math.ceil(rounded / multiple - 1e-12) * multiple;
    if (minimum > 0 && rounded < minimum) rounded = Math.ceil(minimum / multiple - 1e-12) * multiple;
  }
  return rounded;
}

function sampleStdev(series: number[]) {
  if (series.length < 2) return 0;
  const mean = series.reduce((sum, qty) => sum + qty, 0) / series.length;
  const variance = series.reduce((sum, qty) => sum + (qty - mean) ** 2, 0) / (series.length - 1);
  return Math.sqrt(Math.max(variance, 0));
}

function addMonth(month: string) {
  const [yearText, monthText] = month.split("-");
  const year = Number(yearText);
  const monthNumber = Number(monthText);
  const next = new Date(Date.UTC(year, monthNumber, 1));
  const y = next.getUTCFullYear();
  const m = String(next.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

/** Cin7 wins when both sources have the month. Missing months between the ends are zero. */
export function mergeDemand(points: DemandPoint[]) {
  const byMonth = new Map<string, { cin7?: number; orderwise: number }>();
  for (const point of points) {
    const month = point.month.slice(0, 10);
    const slot = byMonth.get(month) ?? { orderwise: 0 };
    if (point.source === "cin7") slot.cin7 = (slot.cin7 ?? 0) + point.qty;
    else slot.orderwise += point.qty;
    byMonth.set(month, slot);
  }
  const keys = [...byMonth.keys()].sort();
  if (keys.length === 0) return { months: [] as string[], qty: [] as number[] };
  const months: string[] = [];
  const qty: number[] = [];
  let cursor = keys[0]!;
  const end = keys[keys.length - 1]!;
  while (cursor <= end && months.length < 240) {
    const slot = byMonth.get(cursor);
    months.push(cursor);
    qty.push(slot?.cin7 != null ? slot.cin7 : (slot?.orderwise ?? 0));
    cursor = addMonth(cursor);
  }
  return { months, qty };
}

export function planSku(input: PlanInput): Plan {
  const classified = classifyDemand(input.monthly);
  const indices = seasonalIndices(input.monthly);
  const intermittent = classified.klass === "intermittent" || classified.klass === "lumpy";
  const seasonal = indices != null && !intermittent && classified.klass !== "insufficient";
  const base = seasonal ? input.monthly.map((qty, index) => qty / (indices[index % 12] || 1)) : input.monthly;
  const level = intermittent ? crostonSba(input.monthly, input.crostonAlpha) : simpleMovingAverage(base, input.smaWindow);
  const method: ForecastMethod = intermittent ? "sba" : seasonal ? "seasonal_sma" : "sma";
  const months = Math.max(1, Math.floor(input.forecastMonths));
  const forecasts = Array.from({ length: months }, (_, offset) => {
    const position = (input.monthly.length + offset) % 12;
    const index = seasonal ? (indices?.[position] ?? 1) : 1;
    return Math.max(0, level * index);
  });
  const average = forecasts.reduce((sum, qty) => sum + qty, 0) / forecasts.length;
  const leadMonths = Math.max(input.leadTimeDays, 0) / DAYS_PER_MONTH;
  const reviewMonths = Math.max(input.reviewDays, 0) / DAYS_PER_MONTH;
  const sigma = sampleStdev(base);
  const safetyStock =
    input.safetyDays == null ? zForServiceLevel(input.serviceLevel) * sigma * Math.sqrt(leadMonths) : average * (Math.max(input.safetyDays, 0) / DAYS_PER_MONTH);
  const leadTimeDemand = average * leadMonths;
  const reorderPoint = leadTimeDemand + safetyStock;
  const orderUpTo = average * (leadMonths + reviewMonths) + safetyStock;
  const net = input.available + input.onOrder;
  const raw = net < reorderPoint ? Math.max(0, orderUpTo - net) : 0;
  const suggestedQty = roundOrderQty(raw, input.moq, input.orderMultiple);
  const zeroStock = input.onHand <= 0;
  const belowReorder = net < reorderPoint;
  const overstock = (orderUpTo > 0 && net > orderUpTo * 2) || (level === 0 && input.onHand > 0);
  const reason: string[] = [];
  if (zeroStock) reason.push("Zero stock");
  if (belowReorder) reason.push("Below reorder point");
  if (suggestedQty > raw) reason.push("Rounded to order multiple");
  if (overstock && !belowReorder) reason.push("Overstock");
  if (reason.length === 0) reason.push("Covered");
  return {
    classification: classified.klass,
    method,
    level,
    forecasts,
    leadTimeDemand,
    safetyStock,
    reorderPoint,
    orderUpTo,
    suggestedQty,
    zeroStock,
    belowReorder,
    overstock,
    reason: reason.join(". "),
  };
}
