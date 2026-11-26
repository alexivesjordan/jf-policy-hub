export type SiteAddressInput = {
  address?: string | null;
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  county?: string | null;
  postcode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

function clean(value: string | null | undefined) {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function compact(value: string) {
  return value.toUpperCase().replace(/\s+/g, "");
}

/** One line for navigation. A separate postcode is added when the address does not already contain it. */
export function navigationAddress(input: SiteAddressInput) {
  const parts = [input.line1, input.line2, input.city, input.county].map(clean).filter(Boolean);
  let address = parts.length > 0 ? parts.join(", ") : clean(input.address);
  const postcode = clean(input.postcode);
  if (postcode && !compact(address).includes(compact(postcode))) {
    address = address ? `${address}, ${postcode}` : postcode;
  }
  return address || null;
}

function point(input: SiteAddressInput) {
  const { latitude: lat, longitude: lng } = input;
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

export function navigationUrls(input: SiteAddressInput) {
  const address = navigationAddress(input);
  if (!address) return null;
  const coords = point(input);
  const waze = coords
    ? `https://waze.com/ul?ll=${coords.lat},${coords.lng}&navigate=yes`
    : `https://waze.com/ul?q=${encodeURIComponent(address)}&navigate=yes`;
  const maps = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;
  return { waze, maps };
}
