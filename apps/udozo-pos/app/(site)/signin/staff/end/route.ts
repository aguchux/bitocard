import { type NextRequest, NextResponse } from "next/server";
import { deviceCookie, staffCookie } from "@/lib/session";

/**
 * A member of staff's session that ended (12 hours idle, signed out elsewhere, suspended, or the device unlinked):
 * its cookie is dropped here (a page cannot), then back to sign in: a linked till's name tiles, else the staff door.
 */
export function GET(request: NextRequest) {
  const onDevice = Boolean(request.cookies.get(deviceCookie)?.value);
  const response = NextResponse.redirect(new URL(onDevice ? "/signin/till" : "/signin?ended=1", request.nextUrl.origin), { status: 303, headers: { "cache-control": "no-store" } });
  response.cookies.delete(staffCookie);
  return response;
}
