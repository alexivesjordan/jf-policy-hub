import { looksLikeUkPostcode } from "@/lib/quotes/postcode";

export function coordinatesFromPostcodesIo(body: unknown): { latitude: number; longitude: number } | null {
  if (!body || typeof body !== "object") return null;
  const result = (body as { result?: { latitude?: unknown; longitude?: unknown } }).result;
  const latitude = result?.latitude;
  const longitude = result?.longitude;
  if (typeof latitude !== "number" || typeof longitude !== "number") return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return {
    latitude: Math.round(latitude * 1e6) / 1e6,
    longitude: Math.round(longitude * 1e6) / 1e6,
  };
}

/** UK postcode centroid. Null when the postcode is not recognised. */
export async function geocodeUkPostcode(postcode: string): Promise<{ latitude: number; longitude: number } | null> {
  if (!looksLikeUkPostcode(postcode)) return null;
  const compact = postcode.replace(/\s+/g, "");
  try {
    const response = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(compact)}`, {
      signal: AbortSignal.timeout(4000),
      headers: { accept: "application/json" },
    });
    if (!response.ok) return null;
    return coordinatesFromPostcodesIo(await response.json());
  } catch {
    return null;
  }
}
