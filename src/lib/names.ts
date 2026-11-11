/** Split a stored display name at the first space. A blank name stays blank. */
export function splitPersonName(value: string | null | undefined): { firstName: string; lastName: string } {
  const trimmed = (value ?? "").trim().replace(/\s+/g, " ");
  if (!trimmed) return { firstName: "", lastName: "" };
  const space = trimmed.indexOf(" ");
  if (space === -1) return { firstName: trimmed, lastName: "" };
  return { firstName: trimmed.slice(0, space), lastName: trimmed.slice(space + 1).trim() };
}

export function personName(first: string, last: string): { firstName: string; lastName: string } | null {
  const firstName = first.trim().replace(/\s+/g, " ");
  const lastName = last.trim().replace(/\s+/g, " ");
  if (!firstName || !lastName) return null;
  if (firstName.length > 80 || lastName.length > 80) return null;
  return { firstName, lastName };
}

export function derivedFullName(first: string, last: string): string | null {
  const name = `${first.trim()} ${last.trim()}`.trim();
  return name || null;
}
