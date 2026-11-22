/** Database and transport failures stay off the client. Known app messages do not. */
export function clientError(error: unknown, fallback: string) {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const message = raw.includes("app:") ? raw.slice(raw.lastIndexOf("app:") + 4).trim() : "";
  if (message && !/violates|constraint|syntax|duplicate key|SQLSTATE|relation |column /i.test(message)) return message;
  if (/^(Could not load|Could not find|Invoice |Cin7 |Order |Price |Enter |Invalid |Duplicate |Different |Choose |One invoice|Shipped )/.test(raw)) return raw;
  return fallback;
}
