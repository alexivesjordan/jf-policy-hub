export function spaceCodeFromName(name: string) {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return slug || "space";
}

export function validSpaceCode(code: string) {
  return /^[a-z0-9][a-z0-9-]{0,39}$/.test(code);
}