import { NextResponse } from "next/server";
import { appUrl } from "@bitocard/ui/site";
import { marketCookie } from "@/lib/market";

/**
 * The escape hatch from a market's own country store (`ng.bitocard.com`…) back to root bitocard.com, shopping every
 * market in US dollars. A plain link, not a server action, because it is followed from another subdomain. Sets the
 * same standing choice the market dialog's "Stay global" does, then sends the shopper home; root then leaves them
 * there instead of bouncing them back to their country store.
 */
export function GET() {
  const response = NextResponse.redirect(new URL("/", appUrl("storefront")), { status: 303 });
  response.cookies.set(marketCookie, "global", {
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  });
  return response;
}
