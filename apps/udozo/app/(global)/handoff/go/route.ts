import { cookies } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { customerApi, customerCookie, safeNext, siteOrigin } from "@/lib/customer";
import { handoffTarget } from "@/lib/handoff";

const redirect = (url: string) => NextResponse.redirect(url, { status: 303, headers: { "cache-control": "no-store", "referrer-policy": "no-referrer" } });

/**
 * Starts the handoff from udozo.com, where the customer is signed in, to one of Udozo's stores (`to`, an origin: its
 * sandbox subdomain or its own domain), landing on `next` there: asks the API for a one-time code bound to that store
 * and sends the browser to its `/handoff` with the code in the fragment. Not signed in here: sign in first, then on.
 */
export async function GET(request: NextRequest) {
  const self = siteOrigin();
  const next = safeNext(request.nextUrl.searchParams.get("next"), "/");
  const to = handoffTarget(request.nextUrl.searchParams.get("to") ?? "", self);
  if (!to) return redirect(new URL(next, self).href);
  const signIn = () => redirect(new URL(`/signin?next=${encodeURIComponent(`/handoff/go?to=${encodeURIComponent(to)}&next=${encodeURIComponent(next)}`)}`, self).href);

  if (!(await cookies()).get(customerCookie)?.value) return signIn();
  const result = await customerApi<{ code: string }>("POST", "/v1/store/account/handoff", { to });
  if (result.ok) return redirect(`${to}/handoff#c=${encodeURIComponent(result.data.code)}&n=${encodeURIComponent(next)}`);
  // The session here ended: sign in again, then on.
  if (result.status === 401) return signIn();
  // Not a store Udozo can hand customers to (closed, unknown) or the API unreachable: back here, never to `to`.
  return redirect(new URL(next, self).href);
}
