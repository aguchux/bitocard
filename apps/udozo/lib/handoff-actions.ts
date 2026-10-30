"use server";

import { type Customer, customerApi, keepSession, safeNext, siteOrigin } from "@/lib/customer";
import { storeOrigin } from "@/lib/store";
import type { HandoffResult } from "@bitocard/ui/handoff-ui";

const codePattern = /^bch_[A-Za-z0-9_-]{20,200}$/;

export type { HandoffResult };

/**
 * The one-time code udozo.com sent to this site (read from `/handoff`'s fragment by the page), exchanged once by this
 * server, naming its own origin, for a session of its own. The session token never reaches the browser. Udozo's stores
 * land here too (their sandbox subdomains and own domains), each naming its own origin.
 */
export async function continueSignIn(code: string, next: string): Promise<HandoffResult> {
  if (!codePattern.test(code)) return { ok: false, unreachable: false };
  // On a reseller's store, the store's own origin (the proxy's): the code was made for it alone.
  const store = await storeOrigin();
  const result = await customerApi<{ customer: Customer; session: { token: string } }>("POST", "/v1/store/account/handoff/exchange", { code, origin: store ?? siteOrigin() });
  if (!result.ok) return { ok: false, unreachable: result.status === 0 || result.status >= 500 };
  await keepSession(result.data.session);
  const to = safeNext(next, "/");
  // Stores have no confirmation page: an unconfirmed email is confirmed on udozo.com, which the store's pages say.
  return { ok: true, next: store || result.data.customer.email_verified ? to : `/verify?next=${encodeURIComponent(to)}` };
}
