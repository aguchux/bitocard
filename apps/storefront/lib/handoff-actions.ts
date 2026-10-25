"use server";

import { type Customer, customerApi, keepSession, safeNext, siteOrigin } from "@/lib/customer";
import { onHouseSite, rememberSignedIn } from "@/lib/handoff";
import type { HandoffResult } from "@bitocard/ui/handoff-ui";

const codePattern = /^bch_[A-Za-z0-9_-]{20,200}$/;

export type { HandoffResult };

/**
 * The code another BitoCard site sent here (read from `/handoff`'s fragment by the page), exchanged once by this
 * server, naming its own origin, for a session of its own. The session token never reaches the browser.
 */
export async function continueSignIn(code: string, next: string): Promise<HandoffResult> {
  if (!(await onHouseSite()) || !codePattern.test(code)) return { ok: false, unreachable: false };
  const result = await customerApi<{ customer: Customer; session: { token: string } }>("POST", "/v1/store/account/handoff/exchange", { code, origin: await siteOrigin() });
  if (!result.ok) return { ok: false, unreachable: result.status === 0 || result.status >= 500 };
  await keepSession(result.data.session);
  await rememberSignedIn(result.data.customer);
  const to = safeNext(next, "/");
  return { ok: true, next: result.data.customer.email_verified ? to : `/account/verify?next=${encodeURIComponent(to)}` };
}
