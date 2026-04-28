import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME } from "@/lib/auth";

/**
 * Routes reachable without an auth cookie. Exact-match only — sub-paths of
 * /api/session (me, balances, topup, transfer) require auth and must NOT be
 * matched by a prefix rule. Per-route handlers also call `requireAuthSession`
 * for defense in depth, but middleware short-circuits before any DB work.
 */
const PUBLIC_PATHS = new Set([
  "/api/session", // POST register / login
  "/api/session/logout", // POST clear cookie (idempotent, safe pre-auth)
  "/api/openapi", // public OpenAPI spec
  "/api/docs", // public Swagger UI
]);

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // CSRF: same-origin enforcement on mutating requests. Browsers always send
  // `Origin` on cross-site fetches and on same-origin POSTs; if it's present
  // and the host doesn't match, the request is cross-origin and we reject.
  // Server-side tools (curl, Postman) typically don't send `Origin`, so we
  // let those through — they'd still need a valid auth cookie, which they
  // can only get by deliberately submitting a login.
  if (UNSAFE_METHODS.has(request.method)) {
    const origin = request.headers.get("origin");
    if (origin) {
      try {
        if (new URL(origin).host !== request.nextUrl.host) {
          return NextResponse.json(
            { error: "Cross-origin request blocked" },
            { status: 403 }
          );
        }
      } catch {
        return NextResponse.json({ error: "Invalid Origin" }, { status: 403 });
      }
    }
  }

  if (PUBLIC_PATHS.has(pathname)) {
    return NextResponse.next();
  }

  const sessionId = request.cookies.get(COOKIE_NAME)?.value;
  if (!sessionId) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (pathname.startsWith("/dashboard")) {
      return NextResponse.redirect(new URL("/", request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/api/:path*"],
};
