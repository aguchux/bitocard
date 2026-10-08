import { NextResponse, type NextRequest } from "next/server";
import { pathHeader } from "./lib/path-header";

/**
 * Account pages only: passes the requested path to the layout (layouts are not given it), so signing in from an order
 * link returns to that order. Always set here, so a caller cannot choose it; the layout still checks it is a local path.
 */
export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set(pathHeader, `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.next({ request: { headers } });
}

export const config = { matcher: ["/account", "/account/:path*"] };
