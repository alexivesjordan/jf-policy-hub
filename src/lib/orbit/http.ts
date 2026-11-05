import { messageFromError } from "@/lib/errors";

export function orbitRpcError(
  error: { message?: string; code?: string } | null | undefined,
  fallback: string,
) {
  const raw = error?.message ?? "";
  const message = messageFromError(error, fallback);
  if (raw.includes("You need to be signed in")) {
    return Response.json({ error: message }, { status: 401 });
  }
  if (
    raw.includes("Only the owner") ||
    raw.includes("Only the install lead") ||
    raw.includes("You cannot") ||
    raw.includes("You do not")
  ) {
    return Response.json({ error: message }, { status: 403 });
  }
  if (raw.includes("app: ")) {
    return Response.json({ error: message }, { status: 400 });
  }
  return Response.json({ error: fallback }, { status: 500 });
}

export async function readJson(request: Request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
