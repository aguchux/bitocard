/** A trader's identity check, as Afrippa's API answers it (`/v1/afrippa/account/verification`). */
export type TraderCheck = {
  object: "customer_verification";
  id: string;
  status: "in_progress" | "in_review" | "approved" | "declined" | "expired";
  /** A single-use link into Verify, only right after starting or continuing a check. */
  url: string | null;
  /** A code (`not_verified`, `expired`…), never shown as it is. */
  reason: string | null;
  created_at: string;
};

export type TraderVerification = {
  object: "trader_verification";
  mode: "live" | "test";
  verified: boolean;
  latest: TraderCheck | null;
};

/** What the trader is told about where their check stands. */
export function checkText(verification: TraderVerification): { title: string; body: string; action: "start" | "continue" | "again" | null } {
  if (verification.verified) return { title: "Your identity is verified", body: "You can trade with real money. You never need to do this again.", action: null };
  const latest = verification.latest;
  if (!latest) return { title: "Verify your identity", body: "Trading with real money needs a quick identity check, once: your ID, a selfie and a short liveness check. It takes about five minutes.", action: "start" };
  if (latest.status === "in_review") return { title: "Your check is with our team", body: "A person on Afrippa's team is checking your documents. We will email you the outcome.", action: null };
  if (latest.status === "in_progress") return { title: "Finish your identity check", body: "You started a check. Carry on where you left off.", action: "continue" };
  // The reason is a code for screens; the email we sent says why in words.
  if (latest.status === "declined") return { title: "Your check was declined", body: "We could not verify you from what was sent; our email says why. Start a new check when you are ready.", action: "again" };
  return { title: "Your check expired", body: "It was not finished in time. Start a new one when you are ready.", action: "again" };
}
