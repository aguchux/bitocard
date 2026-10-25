import { cookies } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { decodeSignedIn, isHouseOrigin, signedInCookie, signedInDomain } from "@bitocard/ui/handoff";
import { customerApi, customerCookie, safeNext, siteOrigin } from "@/lib/customer";

const redirect = (url: string) => NextResponse.redirect(url, { status: 303, headers: { "cache-control": "no-store", "referrer-policy": "no-referrer" } });

/**
 * Starts the handoff from the Shop, where the customer is signed in, to another of BitoCard's own sites (`to`, an
 * origin: their country store's Shop tab, or bitocard.com), landing on `next` there: asks the API for a one-time code
 * bound to that site and sends the browser to its `/handoff` with the code in the fragment. Not signed in here: sign in
 * first, then on.
 */
export async function GET(request: NextRequest) {
  const self = siteOrigin();
  const to = request.nextUrl.searchParams.get("to") ?? "";
  const next = safeNext(request.nextUrl.searchParams.get("next"), "/");
  if (!isHouseOrigin(to) || to === self) return redirect(new URL(next, self).href);
  const signIn = () => redirect(new URL(`/signin?next=${encodeURIComponent(`/handoff/go?to=${encodeURIComponent(to)}&next=${encodeURIComponent(next)}`)}`, self).href);

  const jar = await cookies();
  if (!jar.get(customerCookie)?.value) return signIn();
  const result = await customerApi<{ code: string }>("POST", "/v1/store/account/handoff", { to });
  if (result.ok) return redirect(`${to}/handoff#c=${encodeURIComponent(result.data.code)}&n=${encodeURIComponent(next)}`);
  if (result.status === 401) {
    // The session here ended: the "Continue as" offer that sent them was out of date.
    const response = signIn();
    if (decodeSignedIn(jar.get(signedInCookie)?.value)?.origin === self) response.cookies.set(signedInCookie, "", { domain: signedInDomain(), path: "/", maxAge: 0 });
    return response;
  }
  // That site cannot take a handoff now (a country store closed): the customer signs in there themselves.
  return redirect(`${to}/signin?next=${encodeURIComponent(next)}`);
}
