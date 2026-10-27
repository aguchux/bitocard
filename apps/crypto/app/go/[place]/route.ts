import { type NextRequest, NextResponse } from "next/server";
import { accountPlaces, type AccountPlace } from "@/lib/account";
import { currentCustomer, signInPath, siteOrigin } from "@/lib/customer";
import { tradeHref } from "@/lib/handoff";

const redirect = (url: string) => NextResponse.redirect(url, { status: 303, headers: { "cache-control": "no-store" } });

/**
 * A wallet page on the customer's account app (adding money, deposits, withdrawals, cash out, the identity check),
 * signed in there through the handoff; signed out, signing in here first and coming back.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ place: string }> }) {
  const { place } = await params;
  if (!(place in accountPlaces)) return redirect(new URL("/", siteOrigin()).href);
  const customer = await currentCustomer();
  if (!customer) return redirect(new URL(signInPath(`/go/${place}`), siteOrigin()).href);
  return redirect(tradeHref(customer.country, accountPlaces[place as AccountPlace]));
}
