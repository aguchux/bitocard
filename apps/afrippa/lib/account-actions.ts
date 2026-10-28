"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { addressQr } from "@afrippa/ui/qr";
import { type Trader, type TwoStepState, customerApi, dropSession, keepSession, nextStep, safeNext } from "@/lib/customer";
import { googleErrors, googleFailed, keepGoogleFlow } from "@/lib/google";

export type FormState = { error?: string; field?: string | null; notice?: string };

/** Setting two-step up: the method chosen, what it needs (an authenticator's secret and QR code, or where a code went), then the recovery codes. */
export type SetupState = FormState & {
  method?: "authenticator" | "email" | "sms";
  secret?: string | null;
  qr?: string | null;
  sentTo?: string | null;
  recoveryCodes?: string[];
};

type SessionReply = { customer: Omit<Trader, "two_step">; session: { token: string }; two_step: TwoStepState };

const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
const failed = (result: { message: string; param: string | null }): FormState => ({ error: result.message, field: result.param });

/** A new trader: their account (their country fixed for good), signed in to confirm their email and set two-step up. */
export async function signUp(_state: FormState, form: FormData): Promise<FormState> {
  const result = await customerApi<SessionReply>("POST", "/v1/afrippa/account/signup", {
    name: text(form, "name"),
    email: text(form, "email"),
    country: text(form, "country"),
    password: String(form.get("password") ?? ""),
  });
  if (!result.ok) return failed(result);
  await keepSession(result.data.session);
  redirect(nextStep({ ...result.data.customer, two_step: result.data.two_step }, safeNext(form.get("next"))));
}

/** Email and password; then the email code (if not confirmed yet) and the two-step code. */
export async function signIn(_state: FormState, form: FormData): Promise<FormState> {
  const result = await customerApi<SessionReply>("POST", "/v1/afrippa/account/signin", { email: text(form, "email"), password: String(form.get("password") ?? "") });
  if (!result.ok) return failed(result);
  await keepSession(result.data.session);
  redirect(nextStep({ ...result.data.customer, two_step: result.data.two_step }, safeNext(form.get("next"))));
}

export async function signOut() {
  await customerApi("POST", "/v1/afrippa/account/signout", {});
  await dropSession();
  revalidatePath("/", "layout");
  redirect("/");
}

/** The 6-digit code emailed at sign-up; then two-step. */
export async function verifyEmail(_state: FormState, form: FormData): Promise<FormState> {
  const result = await customerApi("POST", "/v1/afrippa/account/email/verify", { code: text(form, "code") });
  if (!result.ok) return failed(result);
  const account = await customerApi<Trader>("GET", "/v1/afrippa/account");
  const next = safeNext(form.get("next"));
  redirect(account.ok ? nextStep(account.data, next) : `/two-step?next=${encodeURIComponent(next)}`);
}

export async function resendCode(): Promise<FormState> {
  const result = await customerApi("POST", "/v1/afrippa/account/email/resend", {});
  return result.ok ? { notice: "We have sent you a new code." } : failed(result);
}

/** Forgot password: a code is emailed if the address has an account (the answer never says whether it does). */
export async function forgotPassword(_state: FormState, form: FormData): Promise<FormState & { email?: string }> {
  const email = text(form, "email");
  const result = await customerApi("POST", "/v1/afrippa/account/password/forgot", { email });
  if (!result.ok) return failed(result);
  return { notice: "If there is an account for this address, we have emailed it a 6-digit code.", email };
}

/** A new password with the emailed code: every other session ends, and this one still needs the two-step code. */
export async function resetPassword(_state: FormState, form: FormData): Promise<FormState> {
  const result = await customerApi<SessionReply>("POST", "/v1/afrippa/account/password/reset", {
    email: text(form, "email"),
    code: text(form, "code"),
    password: String(form.get("password") ?? ""),
  });
  if (!result.ok) return failed(result);
  await keepSession(result.data.session);
  redirect(`/two-step?next=${encodeURIComponent(safeNext(form.get("next")))}`);
}

type SetupReply = { method: "authenticator" | "email" | "sms"; secret: string | null; otpauth_uri: string | null; sent_to: string | null };

/** Starts setting a two-step method up: an authenticator's secret (with its QR code), or a code emailed or texted. */
export async function chooseMethod(_state: SetupState, form: FormData): Promise<SetupState> {
  // Changing a method already on (from Security) needs a code from it; the first setup does not.
  const current = text(form, "current_code");
  const result = await customerApi<SetupReply>("POST", "/v1/afrippa/account/two-step/setup", { method: text(form, "method"), ...(current ? { current_code: current } : {}) });
  if (!result.ok) return failed(result);
  const { method, secret, otpauth_uri, sent_to } = result.data;
  return { method, secret, sentTo: sent_to, qr: otpauth_uri ? await addressQr(otpauth_uri) : null };
}

/** Confirms the method with its first code: it is on, this session is signed in, and the recovery codes are shown once. */
export async function confirmMethod(state: SetupState, form: FormData): Promise<SetupState> {
  const result = await customerApi<{ recovery_codes: string[] }>("POST", "/v1/afrippa/account/two-step/setup/confirm", { code: text(form, "code") });
  if (!result.ok) return { ...state, ...failed(result) };
  revalidatePath("/", "layout");
  return { method: state.method, recoveryCodes: result.data.recovery_codes };
}

/** Sends the emailed or texted code for signing in (one a minute). */
export async function sendCode(): Promise<FormState> {
  const result = await customerApi<{ sent: boolean; sent_to: string | null }>("POST", "/v1/afrippa/account/two-step/challenge", {});
  if (!result.ok) return failed(result);
  return { notice: result.data.sent ? `We have sent a code${result.data.sent_to ? ` to ${result.data.sent_to}` : ""}.` : "A code was sent less than a minute ago. Check for it, or try again shortly." };
}

/** Sends the emailed or texted code that confirms a money move (releasing coins, adding a payment method). */
export async function sendConfirmCode(): Promise<FormState> {
  const result = await customerApi<{ sent: boolean; sent_to: string | null }>("POST", "/v1/afrippa/account/two-step/challenge", { purpose: "confirm" });
  if (!result.ok) return failed(result);
  return { notice: result.data.sent ? `We have sent a code${result.data.sent_to ? ` to ${result.data.sent_to}` : ""}.` : "A code was sent less than a minute ago. Check for it, or try again shortly." };
}

/** The two-step code (or a recovery code): signed in, or on to set an allowed method up. */
export async function verifyTwoStep(_state: FormState, form: FormData): Promise<FormState> {
  const result = await customerApi<{ signed_in: boolean; setup_required: boolean }>("POST", "/v1/afrippa/account/two-step/verify", { code: text(form, "code") });
  if (!result.ok) return failed(result);
  const next = safeNext(form.get("next"));
  revalidatePath("/", "layout");
  redirect(result.data.signed_in ? next : `/two-step?next=${encodeURIComponent(next)}`);
}

/**
 * Starts signing in (or up) with Google: the API's one-time state is kept in this browser's own cookie, then the
 * browser goes to Google. Signing up needs the country first, as with a password (fixed for good).
 */
export async function startGoogle(_state: FormState, form: FormData): Promise<FormState> {
  const intent = text(form, "intent") === "signup" ? "signup" : "signin";
  const country = text(form, "country").toUpperCase();
  if (intent === "signup" && !/^[A-Z]{2}$/.test(country)) return { error: "Choose your country first: it cannot be changed later.", field: "country" };
  const result = await customerApi<{ url: string; state: string }>("POST", "/v1/afrippa/account/google/start", { intent });
  if (!result.ok) return { error: (result.code && googleErrors[result.code]) || googleFailed };
  await keepGoogleFlow({ state: result.data.state, intent, next: safeNext(form.get("next")), country: intent === "signup" ? country : null });
  redirect(result.data.url);
}

// Security (signed in)

/** A new password with the current one: the trader's other sessions end. Google-only accounts set one with Forgot password. */
export async function changePassword(_state: FormState, form: FormData): Promise<FormState> {
  const result = await customerApi("POST", "/v1/afrippa/account/password/change", { current_password: String(form.get("current_password") ?? ""), password: String(form.get("password") ?? "") });
  if (!result.ok) return failed(result);
  return { notice: "Your password is changed. You were signed out everywhere else." };
}

/** Ten new recovery codes (the old ones stop working), with a code from the current method; shown once. */
export async function newRecoveryCodes(_state: SetupState, form: FormData): Promise<SetupState> {
  const result = await customerApi<{ recovery_codes: string[] }>("POST", "/v1/afrippa/account/two-step/recovery-codes", { code: text(form, "code") });
  if (!result.ok) return failed(result);
  return { recoveryCodes: result.data.recovery_codes };
}

export type PhoneState = FormState & { sent?: boolean };

/** A mobile number of the trader's own country: a code is texted to it, and confirming it lets text messages be a two-step method. */
export async function addPhone(_state: PhoneState, form: FormData): Promise<PhoneState> {
  const result = await customerApi("POST", "/v1/afrippa/account/phone", { phone: text(form, "phone") });
  if (!result.ok) return failed(result);
  return { sent: true, notice: "We have texted you a 6-digit code." };
}

export async function verifyPhone(state: PhoneState, form: FormData): Promise<PhoneState> {
  const result = await customerApi("POST", "/v1/afrippa/account/phone/verify", { code: text(form, "code") });
  if (!result.ok) return { ...state, ...failed(result) };
  revalidatePath("/security");
  return { notice: "Your mobile number is confirmed." };
}
