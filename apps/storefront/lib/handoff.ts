import "server-only";
import { cookies } from "next/headers";
import { decodeSignedIn, encodeSignedIn, signedInCookie, signedInDomain, signedInMaxAge } from "@bitocard/ui/handoff";
import { siteOrigin } from "./customer";
import { customDomain, onResellerStore } from "./store";

/** BitoCard's own sites (bitocard.com and its country stores) take part; resellers' stores and domains never do. */
export async function onHouseSite() {
  return !(await customDomain()) && !(await onResellerStore());
}

const cookieOptions = () => ({ domain: signedInDomain(), path: "/", sameSite: "lax" as const, httpOnly: true, secure: process.env.NODE_ENV === "production" });

/** After signing in here: other BitoCard sites can offer "Continue as <first name>" (Server Actions and route handlers only). */
export async function rememberSignedIn(customer: { name: string }) {
  if (!(await onHouseSite())) return;
  (await cookies()).set(signedInCookie, encodeSignedIn({ name: customer.name, origin: await siteOrigin() }), { ...cookieOptions(), maxAge: signedInMaxAge });
}

/** After signing out here: the offer goes too, unless it names another site the customer is still signed in on. */
export async function forgetSignedIn() {
  const signedIn = decodeSignedIn((await cookies()).get(signedInCookie)?.value);
  if (signedIn && signedIn.origin !== (await siteOrigin())) return;
  (await cookies()).set(signedInCookie, "", { ...cookieOptions(), maxAge: 0 });
}

/** The customer signed in on another of BitoCard's sites, as this browser last saw them, or null. */
export async function signedInElsewhere() {
  if (!(await onHouseSite())) return null;
  const signedIn = decodeSignedIn((await cookies()).get(signedInCookie)?.value);
  if (!signedIn || signedIn.origin === (await siteOrigin())) return null;
  return { ...signedIn, host: new URL(signedIn.origin).host };
}
