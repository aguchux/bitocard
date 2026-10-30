"use server";

import { type Customer, customerApi, keepSession, safeNext, siteOrigin } from "@/lib/customer";
import type { HandoffResult } from "@bitocard/ui/handoff-ui";

const codePattern = /^bch_[A-Za-z0-9_-]{20,200}$/;

export type { HandoffResult };

/**
 * The one-time code udozo.com sent to this site (read from `/handoff`'s fragment by the page), exchanged once by this
 * server, naming its own origin, for a session of its own. The session token never reaches the browser. Udozo's stores
 * on their own addresses land here once they are served by this app (docs/UDOZO_SPINOFF_PLAN.md, step 4).
 */
export async function continueSignIn(code: string, next: string): Promise<HandoffResult> {
  if (!codePattern.test(code)) return { ok: false, unreachable: false };
  const result = await customerApi<{ customer: Customer; session: { token: string } }>("POST", "/v1/store/account/handoff/exchange", { code, origin: siteOrigin() });
  if (!result.ok) return { ok: false, unreachable: result.status === 0 || result.status >= 500 };
  await keepSession(result.data.session);
  const to = safeNext(next, "/");
  return { ok: true, next: result.data.customer.email_verified ? to : `/verify?next=${encodeURIComponent(to)}` };
}
