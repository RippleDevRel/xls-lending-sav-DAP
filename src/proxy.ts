import { NextRequest, NextResponse } from "next/server";

const COOKIE_NAME = "xls66-auth";

const PUBLIC_PATHS = [
  "/api/session",
  "/api/openapi",
  "/api/docs",
  "/terms",
];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
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
