export const EU_MEMBERS = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
]);

export type TaricDuty = {
  thirdCountryPercent: number | null;
  preferencePercent: number | null;
  additional: { label: string; percent: number }[];
};

const DUTY_TITLES = new Map<string, "third" | "preference" | "extra">([
  ["third country duty", "third"],
  ["tariff preference", "preference"],
  ["definitive anti-dumping duty", "extra"],
  ["provisional anti-dumping duty", "extra"],
  ["anti-dumping duty", "extra"],
  ["definitive countervailing duty", "extra"],
  ["provisional countervailing duty", "extra"],
  ["additional duties", "extra"],
  ["safeguard duty", "extra"],
]);

function linesOf(html: string) {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)));
  return text.split("\n").map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
}

function titleKind(line: string) {
  return DUTY_TITLES.get(line.toLowerCase()) ?? null;
}

/**
 * Reads the public TARIC measure-details page.
 * Conditional measures (a certificate, a ship, a low-value consignment) are left out.
 * VAT is not in this page.
 */
export function parseTaricDetails(html: string): TaricDuty {
  const lines = linesOf(html);
  let thirdCountryPercent: number | null = null;
  let preferencePercent: number | null = null;
  const additional: { label: string; percent: number }[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const kind = titleKind(lines[index] ?? "");
    if (!kind) continue;
    let percent: number | null = null;
    let conditional = false;
    for (let cursor = index + 1; cursor < Math.min(lines.length, index + 8); cursor += 1) {
      const line = lines[cursor] ?? "";
      if (titleKind(line)) break;
      if (/show conditions/i.test(line)) {
        conditional = true;
        break;
      }
      const rate = /^(\d+(?:\.\d+)?)\s*%$/.exec(line);
      if (!rate) continue;
      percent = Number(rate[1]);
      break;
    }
    if (conditional || percent == null) continue;
    if (kind === "third" && thirdCountryPercent == null) thirdCountryPercent = percent;
    if (kind === "preference" && (preferencePercent == null || percent < preferencePercent)) preferencePercent = percent;
    if (kind === "extra") additional.push({ label: lines[index] ?? "Additional duty", percent });
  }
  return { thirdCountryPercent, preferencePercent, additional };
}

export function taricMeasuresUrl(code: string, origin: string, asOf: string) {
  const day = asOf.replace(/-/g, "");
  return `https://ec.europa.eu/taxation_customs/dds2/taric/measures.jsp?Lang=en&SimDate=${day}&Area=${origin}&Taric=${code}&Expand=true`;
}

export function taricDetailsUrl(measuresHtml: string) {
  const match = /measures_details\.jsp\?[^'"\s]+/.exec(measuresHtml);
  if (!match) return null;
  return `https://ec.europa.eu/taxation_customs/dds2/taric/${match[0].replace(/&amp;/g, "&")}`;
}
