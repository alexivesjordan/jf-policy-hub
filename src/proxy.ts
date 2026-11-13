import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { passwordLinkHandoff } from "@/lib/auth-link";

const PUBLIC_PREFIXES = ["/login", "/auth/", "/account-inactive", "/no-access", "/access", "/visit", "/api/access/media", "/api/amendments", "/api/policies"];
/** Cron calls this with no session. The route itself rejects a missing Bearer CRON_SECRET. */
const CRON_PATHS = ["/api/orbit/sync-products", "/api/orbit/access-reminders"];

export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return NextResponse.next();

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });
        response = NextResponse.next({ request });
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
  const isPublic = CRON_PATHS.includes(path) || PUBLIC_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix));

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

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
