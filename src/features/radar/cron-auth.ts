export function authorisedCron(header: string | null, secret: string) {
  const expected = secret.trim();
  if (!expected) return false;
  return header === `Bearer ${expected}`;
}
