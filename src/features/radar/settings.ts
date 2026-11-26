import type { RadarScoringConfig, ValueBand } from "@/features/radar/types";

function lines(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function parseRadarSettings(input: {
  keywords: string;
  cpvCodes: string;
  bands: { label: string; min: string; max: string; points: string }[];
}): { ok: true; config: RadarScoringConfig } | { ok: false; message: string } {
  const keywords = [...new Set(lines(input.keywords).map((line) => line.toLowerCase()))];
  if (keywords.length < 1 || keywords.length > 40) return { ok: false, message: "Add between 1 and 40 keywords." };
  if (keywords.some((keyword) => keyword.length < 2 || keyword.length > 60)) {
    return { ok: false, message: "Each keyword needs 2 to 60 characters." };
  }
  const cpvCodes: string[] = [];
  const seenCodes = new Set<string>();
  for (const line of lines(input.cpvCodes)) {
    if (/[a-z]/i.test(line)) return { ok: false, message: "CPV codes are 2 to 8 digits." };
    const code = line.replace(/\D/g, "").slice(0, 8);
    if (!/^[0-9]{2,8}$/.test(code)) return { ok: false, message: "CPV codes are 2 to 8 digits." };
    if (seenCodes.has(code)) continue;
    seenCodes.add(code);
    cpvCodes.push(code);
  }
  if (cpvCodes.length > 30) return { ok: false, message: "Use at most 30 CPV codes." };
  if (cpvCodes.some((code) => !/^[0-9]{2,8}$/.test(code))) return { ok: false, message: "CPV codes are 2 to 8 digits." };
  const valueBands: ValueBand[] = [];
  for (const band of input.bands) {
    const label = band.label.trim();
    const minText = band.min.trim();
    const maxText = band.max.trim();
    const pointsText = band.points.trim();
    if (!label && !minText && !maxText && !pointsText) continue;
    if (!label || label.length > 40) return { ok: false, message: "Each value band needs a label." };
    if (!/^[0-9]+$/.test(pointsText)) return { ok: false, message: "Band points are a whole number from 0 to 40." };
    const points = Number(pointsText);
    if (points > 40) return { ok: false, message: "Band points are a whole number from 0 to 40." };
    const min = minText ? Number(minText) : null;
    const max = maxText ? Number(maxText) : null;
    if ((minText && !Number.isFinite(min)) || (maxText && !Number.isFinite(max))) {
      return { ok: false, message: "Band amounts need to be numbers." };
    }
    if ((min != null && min < 0) || (max != null && max < 0) || (min != null && max != null && min > max)) {
      return { ok: false, message: "Check the value bands." };
    }
    valueBands.push({ label, min, max, points });
  }
  if (valueBands.length > 8) return { ok: false, message: "Use at most 8 value bands." };
  return { ok: true, config: { keywords, cpvCodes, valueBands } };
}

export function settingsToForm(config: RadarScoringConfig) {
  const bands = config.valueBands.slice(0, 4).map((band) => ({
    label: band.label,
    min: band.min == null ? "" : String(band.min),
    max: band.max == null ? "" : String(band.max),
    points: String(band.points),
  }));
  while (bands.length < 4) bands.push({ label: "", min: "", max: "", points: "" });
  return {
    keywords: config.keywords.join("\n"),
    cpvCodes: config.cpvCodes.join("\n"),
    bands,
  };
}
