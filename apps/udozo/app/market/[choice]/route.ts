import { type NextRequest, NextResponse } from "next/server";
import { markets } from "@/lib/api";
import { marketCookie, marketCookieMaxAge } from "@/lib/market-choice";

/**
 * Choosing a country in the header's country menu (`/market/ng`), or All countries (`/market/all`): remembered in
 * `udz_market`, then on to that market (or the showcase across them). A country that is not open is not remembered and
 * goes to the home page instead. Never crawled (robots.txt) and never cached.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ choice: string }> }) {
  const choice = (await params).choice.toLowerCase();
  const open = choice === "all" ? null : (await markets()).data.find(market => market.country.toLowerCase() === choice);
  const remember = choice === "all" ? "all" : open ? open.country : null;
  const response = NextResponse.redirect(new URL(open ? `/${open.country.toLowerCase()}` : "/", request.url), 303);
  response.headers.set("Cache-Control", "no-store");
  if (remember) {
    response.cookies.set(marketCookie, remember, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: marketCookieMaxAge });
  }
  return response;
}
