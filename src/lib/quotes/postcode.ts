/** Insert the space a UK postcode drops, including compact forms such as IP14NJ. */
export function normaliseUkPostcode(value: string): string {
  const compact = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const match = compact.match(/^([A-Z]{1,2}\d[A-Z\d]?)(\d[A-Z]{2})$/);
  if (!match) return value.trim().toUpperCase();
  return `${match[1]} ${match[2]}`;
}

export function looksLikeUkPostcode(value: string): boolean {
  return /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i.test(value.trim());
}
