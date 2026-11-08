import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { confirmationPending, type Customer, customerApi, keepSession, safeNext } from "@/lib/customer";
import { mergeVisitorHistory } from "@/lib/discovery-server";
import { takeFacebookFlow } from "@/lib/facebook";
import { siteOrigin } from "@/lib/site";

type SessionReply = { customer: Customer; session: { token: string }; signed_up: boolean };

const sameState = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** The API's refusals, as the codes the sign-in page words (its own codes, so none reads as Google's). */
const shown: Record<string, string> = {
  facebook_state_invalid: "facebook_state_invalid",
  facebook_email_missing: "facebook_email_missing",
  facebook_not_configured: "facebook_not_configured",
  account_exists_sign_in_with_password: "facebook_account_exists",
  account_disabled: "facebook_disabled",
};

/**
 * Where Facebook returns the browser (`<udozo.com>/auth/facebook/callback`, one of the Meta app's valid OAuth redirect
 * addresses), as Google's callback: finished only with the state this same browser was given, then the customer is
 * signed in (signed up first when no account uses that Facebook account). A new account confirms its email (Udozo's
 * code, sent at once) and onboards at `/verify`. Anything else goes back to the page it started from, with a code.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const flow = await takeFacebookFlow();
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const back = (reason: string) => {
    const page = flow?.intent === "signup" ? "/signup" : "/signin";
    const next = flow ? `next=${encodeURIComponent(flow.next)}&` : "";
    return NextResponse.redirect(new URL(`${page}?${next}auth_error=${encodeURIComponent(reason)}`, siteOrigin()), 303);
  };
  if (!flow || !state || !sameState(state, flow.state)) return back("facebook_state_invalid");
  // Cancelled at Facebook (or Facebook refused).
  if (!code) return back(url.searchParams.get("error") ? "facebook_cancelled" : "facebook_failed");
  const result = await customerApi<SessionReply>("POST", "/v1/store/account/facebook/finish", { state, code, ...(flow.ref ? { ref: flow.ref } : {}) });
  if (!result.ok) return back(shown[result.code ?? ""] ?? "facebook_failed");
  await keepSession(result.data.session);
  await mergeVisitorHistory(result.data.session);
  const next = safeNext(flow.next);
  return NextResponse.redirect(new URL(confirmationPending(result.data.customer) ? `/verify?next=${encodeURIComponent(next)}` : next, siteOrigin()), 303);
}
