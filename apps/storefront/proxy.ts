import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { pathHeader } from "./lib/path-header";
import { visitRequest } from "./lib/visits";

/**
 * Every page (never files, `_next` or prefetches):
 * - counts the view of a reseller's store after the response (`lib/visits.ts`), never delaying or breaking the page;
 * - on account pages (`/account`, and the Shop tab's `/shop`), passes the requested path to the layout (layouts are not
 *   given it), so signing in from an order link returns to that order. Always set here, so a caller cannot choose it; the layout still checks it is a local path.
 */
/** The customer account app's pages: `/account` and the Shop tab, `/shop`. */
const accountApp = (pathname: string) => ["/account", "/shop"].some(base => pathname === base || pathname.startsWith(`${base}/`));

export function proxy(request: NextRequest, event?: NextFetchEvent) {
  const visit = visitRequest(request);
  if (visit && event) event.waitUntil(fetch(visit.url, visit.init).then(() => undefined, () => undefined));
  const { pathname, search } = request.nextUrl;
  if (!accountApp(pathname)) return NextResponse.next();
  const headers = new Headers(request.headers);
  headers.set(pathHeader, `${pathname}${search}`);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/|api/|.*\\.[a-zA-Z]+$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
