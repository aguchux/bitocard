import { humanise } from "@bitocard/admin-ui";
import type { SignupJourneyStatus, SignupMilestone, SignupSurface } from "@bitocard/api-client/admin";

/** Reports > Sign-up journeys: what each step, milestone and refusal means, in words. */
export const surfaceLabels: Record<SignupSurface, string> = { udozo: "udozo.com", shq: "Seller HQ" };

export const milestoneLabels: Record<SignupMilestone, string> = {
  email_entered: "Email entered",
  email_verified: "Email confirmed",
  phone_entered: "Mobile entered",
  phone_verified: "Mobile confirmed",
  account_created: "Account created",
  completed: "Ready to use",
};

/** Where an unfinished journey is: the milestone it has not reached yet. */
export const stuckLabels: Record<SignupMilestone, string> = {
  email_entered: "Never entered an email to sign up",
  email_verified: "Did not confirm the emailed code",
  phone_entered: "Did not give a mobile number",
  phone_verified: "Did not confirm the texted code",
  account_created: "Did not set a password",
  completed: "Account not finished",
};

export const statusLabels: Record<SignupJourneyStatus, string> = { in_progress: "In progress", stuck: "Stuck", completed: "Completed" };
export const statusTones: Record<SignupJourneyStatus, "blue" | "amber" | "green"> = { in_progress: "blue", stuck: "amber", completed: "green" };

const stepLabels: Record<string, string> = {
  signin_lookup: "Tried to sign in (no account)",
  email: "Entered email",
  email_verify: "Entered the emailed code",
  phone: "Entered mobile number",
  phone_verify: "Entered the texted code",
  signup: "Set a password and created the account",
  google: "Continued with Google",
  facebook: "Continued with Facebook",
  whatsapp: "Signed up on WhatsApp",
  profile: "Saved name and country",
  account_email_verify: "Confirmed email from the account",
  account_phone: "Added a mobile from the account",
  account_phone_verify: "Confirmed mobile from the account",
  onboarding_token: "Started setting up the business",
  onboarding: "Set up the business",
  signin: "Signed in",
};
export const stepLabel = (step: string | null | undefined) => (step ? (stepLabels[step] ?? humanise(step)) : "—");

const codeLabels: Record<string, string> = {
  code_invalid: "Wrong code",
  code_expired: "Code expired",
  code_attempts_exceeded: "Too many wrong codes",
  code_recently_sent: "Asked for another code too soon",
  code_daily_limit: "Too many codes today",
  email_taken: "Email already has an account",
  email_in_use: "Email already has an account",
  email_delivery_failed: "The email could not be sent",
  phone_in_use: "Mobile already on another account",
  phone_invalid: "Not a valid mobile number",
  phone_wrong_country: "Mobile from another country",
  phone_verification_unavailable: "Country cannot text (number kept unconfirmed)",
  signup_token_invalid: "Sign-up timed out (over an hour, or already used)",
  password_breached: "Password found in a data breach",
  password_too_weak: "Password too weak",
  invalid_credentials: "Wrong email or password",
  account_locked: "Locked after wrong passwords",
  account_disabled: "Account suspended",
  market_unavailable: "Country not open for sign-up",
  parameter_missing: "A field was left empty",
  parameter_invalid: "A field was not accepted",
  google_account_not_found: "Signed in with Google, but had no account",
  account_exists_sign_in_with_password: "Google or Facebook email already has an account",
  account_exists_sign_in_to_link: "Google or Facebook email already has an account",
  google_cancelled: "Cancelled at Google",
  google_failed: "Google sign-in failed",
  google_state_invalid: "Google sign-in timed out",
  facebook_cancelled: "Cancelled at Facebook",
  facebook_failed: "Facebook sign-in failed",
  facebook_state_invalid: "Facebook sign-in timed out",
  facebook_email_missing: "Facebook shared no email",
  whatsapp_number_in_use: "WhatsApp number already on an account",
  already_owner: "Already owns a business",
  rate_limited: "Too many attempts",
  api_error: "Something went wrong at Udozo",
};
/** How a journey signed up, in words. */
export const methodLabel = (method: string) => (method === "google" ? "Google" : method === "facebook" ? "Facebook" : method === "whatsapp" ? "WhatsApp" : "Email");

export const codeLabel = (code: string | null | undefined) => (code ? (codeLabels[code] ?? humanise(code)) : "—");

export const percent = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 1000) / 10}%` : "—");

/** "4 min", "2 h 5 min", "3 days". */
export function duration(ms: number) {
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h${minutes % 60 ? ` ${minutes % 60} min` : ""}`;
  return `${Math.round(hours / 24)} days`;
}
