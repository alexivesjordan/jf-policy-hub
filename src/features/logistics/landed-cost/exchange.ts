const HOST = "https://www.trade-tariff.service.gov.uk";

export function hmrcRatesUrl(month: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("Enter a valid date.");
  return `${HOST}/api/v2/exchange_rates/files/monthly_csv_${month}.csv`;
}

export function commodityUrl(code: string, asOf: string) {
  if (!/^\d{10}$/.test(code)) throw new Error("Commodity code must be 10 digits.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new Error("Enter a valid date.");
  return `${HOST}/api/v2/commodities/${code}?as_of=${asOf}`;
}

export function searchUrl(query: string) {
  const q = query.trim().slice(0, 80);
  if (!q) throw new Error("Enter a commodity or a description.");
  return `${HOST}/api/v2/search?q=${encodeURIComponent(q)}`;
}

/** HMRC customs rates: foreign currency units per £1, for the month of the declaration. */
export function parseHmrcCsv(csv: string) {
  const lines = csv.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  const rates = new Map<string, { unitsPerGbp: number; start: string; end: string }>();
  for (const line of lines.slice(1)) {
    const cells = splitCsv(line);
    const code = cells[2]?.trim().toUpperCase() ?? "";
    const units = Number(cells[3]);
    if (!/^[A-Z]{3}$/.test(code) || !Number.isFinite(units) || units <= 0) continue;
    rates.set(code, { unitsPerGbp: units, start: cells[4]?.trim() ?? "", end: cells[5]?.trim() ?? "" });
  }
  return rates;
}

function splitCsv(line: string) {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (const char of line) {
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      cells.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current);
  return cells;
}
