"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { confirmationPending, type Customer, customerApi, dropSession, keepSession, safeNext, siteOrigin } from "@/lib/customer";

/** What a form shows after its action: an error (with the field it is about), or a note. */
export type FormState = { error?: string; field?: string | null; notice?: string };

type SessionReply = { customer: Customer; session: { token: string } };

const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
const failed = (result: { message: string; param: string | null }): FormState => ({ error: result.message, field: result.param });

/**
 * Creates a Udozo account on udozo.com (no store named: the API makes it udozo.com's, which works on every Udozo store).
 * The country is fixed for good: the wallet, payouts and the market the customer buys and sells in follow it. The
 * mobile number (of that country) is required and texted a code at once; then the emailed code and the texted one
 * confirm both before the account is used.
 */
export async function signUp(_state: FormState, form: FormData): Promise<FormState> {
  const country = text(form, "country");
  if (!/^[A-Z]{2}$/.test(country)) return { error: "Choose your country.", field: "country" };
  const result = await customerApi<SessionReply>("POST", "/v1/store/account/signup", {
    name: text(form, "name"),
    email: text(form, "email"),
    password: String(form.get("password") ?? ""),
    country,
    // The PhoneInput writes it in E.164 only once it is a valid number for the chosen country.
    phone: text(form, "phone") || undefined,
  });
  if (!result.ok) return failed(result);
  await keepSession(result.data.session);
  redirect(`/verify?next=${encodeURIComponent(safeNext(form.get("next")))}`);
}

/** Signs in with the Udozo account's email and password; an unconfirmed email is confirmed here first. */
export async function signIn(_state: FormState, form: FormData): Promise<FormState> {
  const result = await customerApi<SessionReply>("POST", "/v1/store/account/signin", { email: text(form, "email"), password: String(form.get("password") ?? "") });
  if (!result.ok) return failed(result);
  await keepSession(result.data.session);
  const next = safeNext(form.get("next"));
  redirect(confirmationPending(result.data.customer) ? `/verify?next=${encodeURIComponent(next)}` : next);
}

export async function signOut() {
  await customerApi("POST", "/v1/store/account/signout", {});
  await dropSession();
  revalidatePath("/", "layout");
  redirect("/");
}

/** The 6-digit code emailed at sign-up, for accounts that have not confirmed their email yet; then the mobile's, if still to do. */
export async function verifyEmail(_state: FormState, form: FormData): Promise<FormState> {
  const result = await customerApi<Customer>("POST", "/v1/store/account/email/verify", { code: text(form, "code") });
  if (!result.ok) return failed(result);
  const next = safeNext(form.get("next"));
  redirect(confirmationPending(result.data) ? `/verify?next=${encodeURIComponent(next)}` : next);
}

/** The 6-digit code texted to the mobile at sign-up (or to a number entered on the confirmation page). */
export async function confirmMobile(_state: FormState, form: FormData): Promise<FormState> {
  const result = await customerApi<Customer>("POST", "/v1/store/account/phone/verify", { code: text(form, "code") });
  if (!result.ok) return failed(result);
  revalidatePath("/", "layout");
  redirect(safeNext(form.get("next")));
}

/** Texts a new code: to the number on the account, or to another one typed in its place. */
export async function textMobileCode(_state: FormState & { phone?: string }, form: FormData): Promise<FormState & { phone?: string }> {
  const result = await customerApi<{ object: "notice"; phone: string }>("POST", "/v1/store/account/phone", { phone: text(form, "phone") });
  return result.ok ? { notice: `We sent a new code to ${result.data.phone}.`, phone: result.data.phone } : failed(result);
}

export async function resendCode(): Promise<FormState> {
  const result = await customerApi<Customer>("POST", "/v1/store/account/email/resend", {});
  return result.ok ? { notice: "We have sent you a new code." } : failed(result);
}

/** Emails a code to reset the password (the API says the same whether or not the account exists). */
export async function forgotPassword(_state: FormState, form: FormData): Promise<FormState> {
  const email = text(form, "email");
  const result = await customerApi("POST", "/v1/store/account/password/forgot", { email });
  if (!result.ok) return failed(result);
  redirect(`/reset-password?email=${encodeURIComponent(email)}`);
}

/** The emailed code and a new password: every other session ends, and this one is signed in. */
export async function resetPassword(_state: FormState, form: FormData): Promise<FormState> {
  const result = await customerApi<SessionReply>("POST", "/v1/store/account/password/reset", {
    email: text(form, "email"),
    code: text(form, "code"),
    password: String(form.get("password") ?? ""),
  });
  if (!result.ok) return failed(result);
  await keepSession(result.data.session);
  redirect("/account");
}

export async function updateName(_state: FormState, form: FormData): Promise<FormState> {
  const result = await customerApi<Customer>("POST", "/v1/store/account/profile", { name: text(form, "name") });
  if (!result.ok) return failed(result);
  // The header's menu shows the name too.
  revalidatePath("/", "layout");
  return { notice: "Saved." };
}

/** Sets the country of an account from before it was asked (once: it never changes after). */
export async function setCountry(_state: FormState, form: FormData): Promise<FormState> {
  const result = await customerApi<Customer>("POST", "/v1/store/account/profile", { country: text(form, "country") });
  if (!result.ok) return failed(result);
  revalidatePath("/", "layout");
  return { notice: "Saved. Your wallet and payouts are now in your country's currency." };
}

/** Texts a code to a mobile number of the account's country (written in E.164 by the PhoneInput). */
export async function addPhone(_state: FormState, form: FormData): Promise<FormState> {
  const result = await customerApi<{ object: "notice"; phone: string }>("POST", "/v1/store/account/phone", { phone: text(form, "phone") });
  return result.ok ? { notice: `We sent a code to ${result.data.phone}.` } : failed(result);
}

export async function verifyPhone(_state: FormState, form: FormData): Promise<FormState> {
  const result = await customerApi<Customer>("POST", "/v1/store/account/phone/verify", { code: text(form, "code") });
  if (!result.ok) return failed(result);
  revalidatePath("/account/profile");
  return { notice: "Your phone number is confirmed." };
}

export async function changePassword(_state: FormState, form: FormData): Promise<FormState> {
  const result = await customerApi<Customer>("POST", "/v1/store/account/password/change", {
    current_password: String(form.get("current_password") ?? ""),
    password: String(form.get("password") ?? ""),
  });
  return result.ok ? { notice: "Your password has changed. Other devices have been signed out." } : failed(result);
}

type Verification = { url?: string | null; status: string };

/**
 * Starts the identity check (Udozo Verify) and sends the customer to it, returning to this site's own page. Safe pay
 * sellers pass it once before they are paid.
 */
export async function startVerification(_state: FormState, form: FormData): Promise<FormState> {
  const country = text(form, "country");
  const result = await customerApi<Verification>("POST", "/v1/store/account/verification", {
    country,
    first_name: text(form, "first_name"),
    last_name: text(form, "last_name"),
    consent: form.get("consent") === "on",
    redirect_url: `${siteOrigin()}/account/verification`,
  });
  if (!result.ok) return failed(result);
  if (result.data.url) redirect(result.data.url);
  revalidatePath("/account/verification");
  return { notice: result.data.status === "approved" ? "You are verified." : "Your check has started." };
}
