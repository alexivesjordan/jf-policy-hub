export function messageFromError(
  error: { message?: string } | null | undefined,
  fallback: string,
) {
  const message = error?.message ?? "";
  const marker = "app: ";
  const index = message.lastIndexOf(marker);
  if (index >= 0) return message.slice(index + marker.length);
  if (message) console.error(message);
  return fallback;
}
