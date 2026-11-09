import { type NextRequest, NextResponse } from "next/server";
import { safeNext, signInUrl } from "@/lib/site";

/**
 * Sign in: there are no passwords here. The browser goes to udozo.com's handoff, which signs the person in with their
 * Udozo account if needed and sends them back to `/handoff` with a one-time code, landing on `next`.
 */
export function GET(request: NextRequest) {
  const next = safeNext(request.nextUrl.searchParams.get("next"), "/apply");
  return NextResponse.redirect(signInUrl(next), { status: 303, headers: { "cache-control": "no-store", "referrer-policy": "no-referrer" } });
}
