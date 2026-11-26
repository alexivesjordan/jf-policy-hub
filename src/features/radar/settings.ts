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
  exclusions?: string;
  bands: { label: string; min: string; max: string; points: string }[];
  hubspotPipelineId?: string;
  hubspotStageId?: string;
  hubspotOwnerId?: string;
  hubspotPortalId?: string;
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
  const exclusions = [...new Set(lines(input.exclusions ?? "").map((line) => line.toLowerCase()))];
  if (exclusions.length > 40) return { ok: false, message: "Use at most 40 exclusion words." };
  if (exclusions.some((word) => word.length < 2 || word.length > 60)) {
    return { ok: false, message: "Each exclusion needs 2 to 60 characters." };
  }
  const hubspot = {
    hubspotPipelineId: (input.hubspotPipelineId ?? "").trim(),
    hubspotStageId: (input.hubspotStageId ?? "").trim(),
    hubspotOwnerId: (input.hubspotOwnerId ?? "").trim(),
    hubspotPortalId: (input.hubspotPortalId ?? "").trim(),
  };
  if (Object.values(hubspot).some((value) => value.length > 40)) return { ok: false, message: "HubSpot ids are too long." };
  if (hubspot.hubspotPortalId && !/^\d+$/.test(hubspot.hubspotPortalId)) return { ok: false, message: "The HubSpot portal id is numeric." };
  return { ok: true, config: { keywords, cpvCodes, valueBands, exclusions, ...hubspot } };
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
    exclusions: config.exclusions.join("\n"),
    bands,
    hubspotPipelineId: config.hubspotPipelineId,
    hubspotStageId: config.hubspotStageId,
    hubspotOwnerId: config.hubspotOwnerId,
    hubspotPortalId: config.hubspotPortalId,
  };
}
