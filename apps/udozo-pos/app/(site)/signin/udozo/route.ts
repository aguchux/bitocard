import { type NextRequest, NextResponse } from "next/server";
import { safeNext, signInUrl } from "@/lib/site";

/**
 * Continue with Udozo: the browser goes to udozo.com's handoff, which signs the owner in with their Udozo account if
 * needed and sends them back to `/handoff` with a one-time code, landing on `next`.
 */
export function GET(request: NextRequest) {
  const next = safeNext(request.nextUrl.searchParams.get("next"));
  return NextResponse.redirect(signInUrl(next), { status: 303, headers: { "cache-control": "no-store", "referrer-policy": "no-referrer" } });
}
