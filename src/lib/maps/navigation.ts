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
