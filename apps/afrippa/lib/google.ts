import "server-only";
import { cookies } from "next/headers";

/**
 * Google sign-in's round trip on Afrippa's site. Starting it keeps the API's one-time `state` (with what the trader
 * asked: sign in or sign up, their country, where to go next) in this site's own `afr_google` cookie: host-only,
 * httpOnly, `SameSite=Lax` (Google returns with a top-level GET), 10 minutes. The callback finishes only when Google
 * returns that same state to the same browser, so a round trip started elsewhere can never sign anyone in here.
 */
export const googleCookie = "afr_google";
const tenMinutes = 60 * 10;

export type GoogleFlow = { state: string; intent: "signin" | "signup"; next: string; country: string | null };

export async function keepGoogleFlow(flow: GoogleFlow) {
  (await cookies()).set(googleCookie, JSON.stringify(flow), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: tenMinutes,
  });
}

/** The flow this browser started, taken once (the cookie is removed whatever happens next). */
export async function takeGoogleFlow(): Promise<GoogleFlow | null> {
  const jar = await cookies();
  const raw = jar.get(googleCookie)?.value;
  jar.delete(googleCookie);
  if (!raw) return null;
  try {
    const flow = JSON.parse(raw) as Partial<GoogleFlow>;
    if (typeof flow.state !== "string" || (flow.intent !== "signin" && flow.intent !== "signup") || typeof flow.next !== "string") return null;
    return { state: flow.state, intent: flow.intent, next: flow.next, country: typeof flow.country === "string" ? flow.country : null };
  } catch {
    return null;
  }
}

/** What a refused Google sign-in tells the trader, by the API's code. */
export const googleErrors: Record<string, string> = {
  google_account_not_found: "No Afrippa account uses this Google account yet. Create one first.",
  account_exists_sign_in_with_password: "An Afrippa account already uses this email. Sign in with your email and password.",
  google_not_configured: "Signing in with Google is not available yet. Use your email and password.",
  google_state_invalid: "That took too long. Try signing in with Google again.",
  account_disabled: "This account cannot sign in. Contact Afrippa's support.",
};
export const googleFailed = "Google sign-in did not work. Try again.";

/** The words for an `auth_error` code in the address (only known codes; anything else reads as the general failure). */
export const googleErrorText = (code: string | undefined) => (code ? (googleErrors[code] ?? googleFailed) : null);
