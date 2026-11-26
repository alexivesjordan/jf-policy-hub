export function londonDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value + "T00:00:00Z"));
}

export function monthOf(isoDate: string) {
  return isoDate.slice(0, 7);
}

/** Nearest penny. Positive amounts only. */
export function toGbpPence(amount: number, unitsPerGbp: number) {
  if (!Number.isFinite(amount) || amount < 0) throw new Error("Amount must be zero or more.");
  if (!Number.isFinite(unitsPerGbp) || unitsPerGbp <= 0) throw new Error("Enter an exchange rate.");
  return Math.round((amount / unitsPerGbp) * 100);
}

export function formatGbp(pence: number) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(pence / 100);
}

export function allocatePence(total: number, weights: number[]) {
  const whole = Math.round(total);
  if (whole < 0 || weights.some((weight) => !Number.isFinite(weight) || weight < 0)) throw new Error("Amount must be zero or more.");
  const sum = weights.reduce((totalWeight, weight) => totalWeight + weight, 0);
  if (whole === 0 || sum <= 0) return weights.map(() => 0);
  const exact = weights.map((weight) => (whole * weight) / sum);
  const base = exact.map((value) => Math.floor(value));
  let used = base.reduce((totalUsed, value) => totalUsed + value, 0);
  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((left, right) => right.fraction - left.fraction || left.index - right.index);
  let cursor = 0;
  while (used < whole) {
    const next = order[cursor % order.length];
    if (!next) break;
    base[next.index] += 1;
    used += 1;
    cursor += 1;
    if (cursor > order.length * 2) break;
  }
  return base;
}
