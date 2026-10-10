"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { type Customer, customerApi, dropSession, keepSession, safeNext, siteOrigin } from "@/lib/customer";

/** What a form shows after its action: an error (with the field it is about), or a note. */
export type FormState = {
  error?: string;
  field?: string | null;
  notice?: string;
  /** Paying from the wallet: the price quoted, for the customer to confirm before it is taken. */
  preview?: { quote_id: string; amount: number; currency: string; wallet_balance: number; expires_at: string };
};

type SessionReply = { customer: Customer; session: { token: string } };

const text = (form: FormData, name: string) => String(form.get(name) ?? "").trim();
const failed = (result: { message: string; param: string | null }): FormState => ({ error: result.message, field: result.param });

export async function signUp(_state: FormState, form: FormData): Promise<FormState> {
  const result = await customerApi<SessionReply>("POST", "/v1/store/account/signup", { name: text(form, "name"), email: text(form, "email"), password: String(form.get("password") ?? "") });
  if (!result.ok) return failed(result);
  await keepSession(result.data.session);
  redirect(`/account/verify?next=${encodeURIComponent(safeNext(form.get("next")))}`);
}

export async function signIn(_state: FormState, form: FormData): Promise<FormState> {
  const result = await customerApi<SessionReply>("POST", "/v1/store/account/signin", { email: text(form, "email"), password: String(form.get("password") ?? "") });
  if (!result.ok) return failed(result);
  await keepSession(result.data.session);
  const next = safeNext(form.get("next"));
  redirect(result.data.customer.email_verified ? next : `/account/verify?next=${encodeURIComponent(next)}`);
}

export async function signOut() {
  await customerApi("POST", "/v1/store/account/signout", {});
  await dropSession();
  revalidatePath("/", "layout");
  redirect("/");
}

export async function verifyEmail(_state: FormState, form: FormData): Promise<FormState> {
  const result = await customerApi<Customer>("POST", "/v1/store/account/email/verify", { code: text(form, "code") });
  if (!result.ok) return failed(result);
  redirect(safeNext(form.get("next")));
}

export async function resendCode(): Promise<FormState> {
  const result = await customerApi<Customer>("POST", "/v1/store/account/email/resend", {});
  return result.ok ? { notice: "We have sent you a new code." } : failed(result);
}

export async function forgotPassword(_state: FormState, form: FormData): Promise<FormState> {
  const email = text(form, "email");
  const result = await customerApi("POST", "/v1/store/account/password/forgot", { email });
  if (!result.ok) return failed(result);
  redirect(`/reset-password?email=${encodeURIComponent(email)}`);
}

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
  revalidatePath("/account");
  return { notice: "Saved." };
}

export async function changePassword(_state: FormState, form: FormData): Promise<FormState> {
  const result = await customerApi<Customer>("POST", "/v1/store/account/password/change", {
    current_password: String(form.get("current_password") ?? ""),
    password: String(form.get("password") ?? ""),
  });
  return result.ok ? { notice: "Your password has changed. Other devices have been signed out." } : failed(result);
}

type Checkout = { object: "checkout"; id: string; mode: "test" | "live"; checkout_url: string | null };
type Preview = { object: "checkout_preview"; quote_id: string; amount: number; currency: string; wallet_balance: number; expires_at: string };

/**
 * Opens the payment page for the product chosen; the payment page returns to the order. Paying from the wallet takes two
 * steps: the price is quoted for the customer to see (`preview`), then that quote is paid (`quote_id`).
 */
export async function startCheckout(_state: FormState, form: FormData): Promise<FormState> {
  const recipient: Record<string, string> = {};
  for (const name of ["phone", "account_number", "email"] as const) {
    const value = text(form, `recipient_${name}`);
    if (value) recipient[name] = value;
  }
  // A listed value comes in minor units; an amount the customer typed, in the currency's main unit.
  const amount = text(form, "face_value_minor") ? Number(text(form, "face_value_minor")) : Math.round(Number(text(form, "face_value")) * 100);
  if (!Number.isFinite(amount) || amount <= 0) return { error: "Choose a value.", field: "face_value" };
  const method = text(form, "method") || undefined;
  const fromWallet = form.get("wallet_required") === "1" || method === "wallet";
  const quoteId = text(form, "quote_id") || undefined;
  const result = await customerApi<Checkout | Preview>("POST", "/v1/store/checkouts", {
    product_id: text(form, "product_id"),
    face_value: amount,
    quantity: Number(text(form, "quantity") || 1),
    country: text(form, "country"),
    method,
    recipient: Object.keys(recipient).length ? recipient : undefined,
    return_url: `${await siteOrigin()}/checkout/return`,
    ...(fromWallet ? (quoteId ? { quote_id: quoteId } : { preview: true }) : {}),
  });
  if (!result.ok) {
    if (result.status === 401) redirect(`/signin?next=${encodeURIComponent(safeNext(form.get("back"), "/"))}`);
    if (result.code === "email_not_verified") redirect(`/account/verify?next=${encodeURIComponent(safeNext(form.get("back"), "/"))}`);
    if (result.code === "customer_verification_required") redirect(`/account/verification?country=${encodeURIComponent(text(form, "country"))}`);
    // The wallet is too low: the form offers a top-up.
    if (result.code === "wallet_balance_low") return { error: result.message, field: "wallet" };
    return failed({ ...result, param: result.param?.replace(/^recipient\./, "recipient_") ?? null });
  }
  if (result.data.object === "checkout_preview") {
    const { quote_id, amount, currency, wallet_balance, expires_at } = result.data;
    return { preview: { quote_id, amount, currency, wallet_balance, expires_at } };
  }
  // Live: to the payment page. Paid from the wallet, or in the sandbox: straight to the order.
  redirect(result.data.mode === "live" && result.data.checkout_url ? result.data.checkout_url : `/account/orders/${result.data.id}`);
}

/** Sandbox orders only: pay (or fail) without a payment page. */
export async function simulateCheckout(form: FormData) {
  const id = text(form, "id");
  await customerApi("POST", `/v1/store/checkouts/${encodeURIComponent(id)}/simulate`, { outcome: text(form, "outcome"), order: text(form, "order") || undefined });
  revalidatePath(`/account/orders/${id}`);
}

type Verification = { url?: string | null; status: string };

/** Starts the identity check (BVN in Nigeria, an ID check elsewhere) and sends the customer to it. */
export async function startVerification(_state: FormState, form: FormData): Promise<FormState> {
  const country = text(form, "country");
  const result = await customerApi<Verification>("POST", "/v1/store/account/verification", {
    country,
    first_name: text(form, "first_name"),
    last_name: text(form, "last_name"),
    bvn: text(form, "bvn") || undefined,
    consent: form.get("consent") === "on",
    redirect_url: `${await siteOrigin()}/account/verification?country=${encodeURIComponent(country)}`,
  });
  if (!result.ok) return failed(result);
  if (result.data.url) redirect(result.data.url);
  revalidatePath("/account/verification");
  return { notice: result.data.status === "approved" ? "You are verified." : "Your check has started." };
}
