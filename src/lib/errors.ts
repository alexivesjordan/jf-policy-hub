export function messageFromError(
  error: { message?: string; details?: string } | null | undefined,
  fallback: string,
) {
  const message = `${error?.message ?? ""} ${error?.details ?? ""}`;
  if (message.includes("installs_quote_id_key")) {
    return "This quote has changed. Reload the order.";
  }
  const marker = "app: ";
  const index = message.lastIndexOf(marker);
  if (index >= 0) return message.slice(index + marker.length);
  if (message) console.error(message);
  return fallback;
}
