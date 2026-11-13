import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { passwordLinkHandoff } from "@/lib/auth-link";

const PUBLIC_PREFIXES = ["/login", "/auth/", "/account-inactive", "/no-access", "/access", "/visit", "/api/access/media", "/api/amendments", "/api/policies"];
/** Cron calls this with no session. The route itself rejects a missing Bearer CRON_SECRET. */
const CRON_PATHS = ["/api/orbit/sync-products", "/api/orbit/access-reminders"];
/** Resend inbound. The route verifies the Svix signature and does not use a session. */
const WEBHOOK_PATHS = ["/api/orbit/inbound-email"];

function continueRequest(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set("x-pathname", request.nextUrl.pathname);
  return NextResponse.next({ request: { headers } });
}

export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return continueRequest(request);

  let response = continueRequest(request);
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });
        response = continueRequest(request);
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  let user = null;
  try {
    const result = await supabase.auth.getUser();
    user = result.data.user;
  } catch (error) {
    console.error("Could not refresh the session", error);
    return response;
  }

  const path = request.nextUrl.pathname;
  const isPublic = CRON_PATHS.includes(path) || WEBHOOK_PATHS.includes(path) || PUBLIC_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix));

  if (!user && !isPublic) {
    const handoff = passwordLinkHandoff(path, request.nextUrl.searchParams);
    if (handoff) return NextResponse.redirect(new URL(handoff, request.url));

    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    redirectUrl.search = "";
    if (path !== "/") redirectUrl.searchParams.set("next", path);
    return NextResponse.redirect(redirectUrl);
  }

  if (user && path === "/login") {
    return NextResponse.redirect(new URL("/", request.url));
  }

  if (user && path.startsWith("/operations") && !path.startsWith("/operations/documents")) {
    const { data } = await supabase.rpc("install_field_role");
    if (data === "engineer") {
      const redirect = NextResponse.redirect(new URL("/field", request.url));
      for (const cookie of response.headers.getSetCookie()) redirect.headers.append("set-cookie", cookie);
      return redirect;
    }
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
