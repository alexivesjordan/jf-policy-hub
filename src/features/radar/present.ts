export function formatUkDate(value: string | null | undefined) {
  if (!value) return "Not published";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(
      new Date(Date.UTC(year, month - 1, day)),
    );
  }
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf())) return "Not published";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Europe/London",
  }).format(date);
}

export function formatMoney(value: unknown, currency: unknown) {
  if (value == null || value === "") return "Not published";
  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(amount)) return "Not published";
  const code = typeof currency === "string" && /^[A-Z]{3}$/.test(currency) ? currency : "GBP";
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: code, maximumFractionDigits: 0 }).format(amount);
}

export function formatWhen(value: string | null) {
  if (!value) return "Not published";
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf())) return "Not published";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
  }).format(date);
}
