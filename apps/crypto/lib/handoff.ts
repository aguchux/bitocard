import "server-only";
import { cookies } from "next/headers";
import { decodeSignedIn, encodeSignedIn, handoffStart, signedInCookie, signedInDomain, signedInMaxAge } from "@bitocard/ui/handoff";
import { appUrl } from "@bitocard/ui/site";
import { siteOrigin } from "./customer";

const cookieOptions = () => ({ domain: signedInDomain(), path: "/", sameSite: "lax" as const, httpOnly: true, secure: process.env.NODE_ENV === "production" });

/** After signing in here: bitocard.com and its country stores can offer "Continue as <first name>" (Server Actions and route handlers only). */
export async function rememberSignedIn(customer: { name: string }) {
  (await cookies()).set(signedInCookie, encodeSignedIn({ name: customer.name, origin: siteOrigin() }), { ...cookieOptions(), maxAge: signedInMaxAge });
}

/** After signing out here: the offer goes too, unless it names another site the customer is still signed in on. */
export async function forgetSignedIn() {
  const signedIn = decodeSignedIn((await cookies()).get(signedInCookie)?.value);
  if (signedIn && signedIn.origin !== siteOrigin()) return;
  (await cookies()).set(signedInCookie, "", { ...cookieOptions(), maxAge: 0 });
}

/** The customer signed in on another of BitoCard's sites, as this browser last saw them, or null. */
export async function signedInElsewhere() {
  const signedIn = decodeSignedIn((await cookies()).get(signedInCookie)?.value);
  if (!signedIn || signedIn.origin === siteOrigin()) return null;
  return { ...signedIn, host: new URL(signedIn.origin).host };
}

/**
 * A customer's own country store (`https://ng.bitocard.com`), where their account app and its Shop tab live: a
 * two-letter subdomain of bitocard.com (or of the configured store address in development).
 */
export function countryStoreOrigin(country: string) {
  const store = new URL(appUrl("storefront"));
  return `${store.protocol}//${country.toLowerCase()}.${store.host}`;
}

/**
 * Where a signed-in customer trades: the Crypto tab of their own country store (`https://ng.bitocard.com/account/crypto`),
 * else bitocard.com's, signed in there through the handoff: this site's `/handoff/go` asks for a one-time code and sends
 * them on, so they never sign in twice. `path` is the Crypto tab's address with the market and filters.
 */
export function tradeHref(country: string | null, path: string) {
  return handoffStart(siteOrigin(), country ? countryStoreOrigin(country) : new URL(appUrl("storefront")).origin, path);
}
