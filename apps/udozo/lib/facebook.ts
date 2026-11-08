import "server-only";
import { cookies } from "next/headers";
import { googleErrorText } from "@/lib/google";

/**
 * "Continue with Facebook" on udozo.com, kept as Google's is (`lib/google.ts`): starting it keeps the API's one-time
 * `state` (with what was asked and where to go next) in this site's own `udz_facebook` cookie, host-only, httpOnly,
 * `SameSite=Lax`, 10 minutes. The callback finishes only when Facebook returns that same state to the same browser.
 */
export const facebookCookie = "udz_facebook";
const tenMinutes = 60 * 10;

export type FacebookFlow = { state: string; intent: "signin" | "signup"; next: string; ref: string | null };

export async function keepFacebookFlow(flow: FacebookFlow) {
  (await cookies()).set(facebookCookie, JSON.stringify(flow), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: tenMinutes });
}

/** The flow this browser started, taken once (the cookie is removed whatever happens next). */
export async function takeFacebookFlow(): Promise<FacebookFlow | null> {
  const jar = await cookies();
  const raw = jar.get(facebookCookie)?.value;
  jar.delete(facebookCookie);
  if (!raw) return null;
  try {
    const flow = JSON.parse(raw) as Partial<FacebookFlow>;
    if (typeof flow.state !== "string" || (flow.intent !== "signin" && flow.intent !== "signup") || typeof flow.next !== "string") return null;
    return { state: flow.state, intent: flow.intent, next: flow.next, ref: typeof flow.ref === "string" ? flow.ref : null };
  } catch {
    return null;
  }
}

/** What a refused Facebook sign-in tells the customer, by the code in the address. */
export const facebookErrors: Record<string, string> = {
  facebook_not_configured: "Signing in with Facebook is not available yet. Use your email or Google instead.",
  facebook_state_invalid: "That took too long. Try Facebook again.",
  facebook_email_missing: "Facebook did not share your email address. Try again and allow Udozo to see your email, or use your email instead.",
  facebook_account_exists: "A Udozo account already uses this email. Sign in with your password or Google.",
  facebook_cancelled: "Facebook sign-in was cancelled.",
  facebook_disabled: "This account cannot sign in. Contact Udozo's support.",
};
export const facebookFailed = "Facebook sign-in did not work. Try again.";

/** The words for an `auth_error` code from Google or Facebook (only known codes; anything else reads as that sign-in's failure). */
export const authErrorText = (code: string | undefined) => (code?.startsWith("facebook_") ? (facebookErrors[code] ?? facebookFailed) : googleErrorText(code));
