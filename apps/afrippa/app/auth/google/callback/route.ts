import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { customerApi, keepSession, nextStep, safeNext, siteOrigin, type Trader, type TwoStepState } from "@/lib/customer";
import { takeGoogleFlow } from "@/lib/google";

type SessionReply = { customer: Omit<Trader, "two_step">; session: { token: string }; two_step: TwoStepState };

const sameState = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * Where Google returns the browser (`<AFRIPPA_URL>/auth/google/callback`, or the redirect address Afrippa's admins set):
 * finished only with the state this same browser was given, then the trader is signed in (signed up first when asked)
 * and goes on to confirm two-step, as after any sign-in. Anything else goes back to the page it started from, saying why.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const flow = await takeGoogleFlow();
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  // Back with a code the page turns into words (never words from the address, which anyone could write).
  const back = (reason: string) => {
    const page = flow?.intent === "signup" ? "/signup" : "/signin";
    const next = flow ? `next=${encodeURIComponent(flow.next)}&` : "";
    return NextResponse.redirect(new URL(`${page}?${next}auth_error=${encodeURIComponent(reason)}`, siteOrigin()), 303);
  };
  if (!flow || !state || !sameState(state, flow.state)) return back("google_state_invalid");
  // Cancelled at Google, or Google refused.
  if (!code) return back("google_failed");
  const result = await customerApi<SessionReply>("POST", "/v1/afrippa/account/google/finish", { state, code, ...(flow.country ? { country: flow.country } : {}) });
  if (!result.ok) return back(result.code ?? "google_failed");
  await keepSession(result.data.session);
  return NextResponse.redirect(new URL(nextStep({ ...result.data.customer, two_step: result.data.two_step }, safeNext(flow.next)), siteOrigin()), 303);
}
