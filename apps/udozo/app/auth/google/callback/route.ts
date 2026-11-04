import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { confirmationPending, type Customer, customerApi, keepSession, safeNext } from "@/lib/customer";
import { takeGoogleFlow } from "@/lib/google";
import { siteOrigin } from "@/lib/site";

type SessionReply = { customer: Customer; session: { token: string }; signed_up: boolean };

const sameState = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * Where Google returns the browser (`<udozo.com>/auth/google/callback`, one of the Google client's redirect addresses):
 * finished only with the state this same browser was given, then the customer is signed in (signed up first when no
 * account uses that Google account, whether they chose sign-in or sign-up).
 * A new account, or one still to finish, goes on to onboarding (`/verify`: its name, country and mobile, in one step).
 * Anything else goes back to the page it started from, with a code the page turns into words.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const flow = await takeGoogleFlow();
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const back = (reason: string) => {
    const page = flow?.intent === "signup" ? "/signup" : "/signin";
    const next = flow ? `next=${encodeURIComponent(flow.next)}&` : "";
    return NextResponse.redirect(new URL(`${page}?${next}auth_error=${encodeURIComponent(reason)}`, siteOrigin()), 303);
  };
  if (!flow || !state || !sameState(state, flow.state)) return back("google_state_invalid");
  // Cancelled at Google, or Google refused.
  if (!code) return back("google_failed");
  const result = await customerApi<SessionReply>("POST", "/v1/store/account/google/finish", { state, code, ...(flow.ref ? { ref: flow.ref } : {}) });
  if (!result.ok) return back(result.code ?? "google_failed");
  await keepSession(result.data.session);
  const next = safeNext(flow.next);
  return NextResponse.redirect(new URL(confirmationPending(result.data.customer) ? `/verify?next=${encodeURIComponent(next)}` : next, siteOrigin()), 303);
}
