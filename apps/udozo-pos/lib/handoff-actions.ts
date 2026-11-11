"use server";

import type { HandoffResult } from "@bitocard/ui/handoff-ui";
import { type Customer, customerApi, keepSession } from "./session";
import { safeNext, siteOrigin } from "./site";

const codePattern = /^bch_[A-Za-z0-9_-]{20,200}$/;

/**
 * The one-time code udozo.com sent here (read from `/handoff`'s fragment by the page), exchanged once by this server,
 * naming this site's own origin, for a session of its own. The session token never reaches the browser.
 */
export async function continueSignIn(code: string, next: string): Promise<HandoffResult> {
  if (!codePattern.test(code)) return { ok: false, unreachable: false };
  const result = await customerApi<{ customer: Customer; session: { token: string } }>("POST", "/v1/store/account/handoff/exchange", { code, origin: siteOrigin() });
  if (!result.ok) return { ok: false, unreachable: result.status === 0 || result.status >= 500 };
  await keepSession(result.data.session);
  return { ok: true, next: safeNext(next, "/app") };
}
