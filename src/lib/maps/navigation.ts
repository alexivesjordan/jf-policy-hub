/** Directions links shared by service visits and install jobs. */
export function navigationLinks(destination: string | null | undefined) {
  const trimmed = destination?.trim() ?? "";
  if (!trimmed) return null;
  const query = encodeURIComponent(trimmed);
  return {
    waze: `https://waze.com/ul?q=${query}&navigate=yes`,
    google: `https://www.google.com/maps/dir/?api=1&destination=${query}`,
  };
}

const DEPOT_ORIGIN = "56 Oldmedow Road, Hardwick Industrial Estate, King's Lynn, PE30 4JJ";

/** Google Maps driving link from the King's Lynn depot through the stops, in order. */
export function multiStopLink(stops: string[]) {
  const points = stops.map((stop) => stop.trim()).filter(Boolean).slice(0, 10);
  if (points.length === 0) return null;
  const destination = points[points.length - 1] ?? "";
  const waypoints = points.slice(0, -1);
  const params = new URLSearchParams({
    api: "1",
    travelmode: "driving",
    origin: DEPOT_ORIGIN,
    destination,
  });
  if (waypoints.length > 0) params.set("waypoints", waypoints.join("|"));
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}
