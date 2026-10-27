"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { type Customer, customerApi, dropSession, keepSession, safeNext } from "@/lib/customer";
import { forgetSignedIn, rememberSignedIn } from "@/lib/handoff";

export type FormState = { error?: string; field?: string | null; notice?: string };

type SessionReply = { customer: Customer; session: { token: string } };

const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
const failed = (result: { message: string; param: string | null }): FormState => ({ error: result.message, field: result.param });

/** Signs in with a bitocard.com account (the email and password); an unconfirmed email is confirmed here first. */
export async function signIn(_state: FormState, form: FormData): Promise<FormState> {
  const result = await customerApi<SessionReply>("POST", "/v1/store/account/signin", { email: text(form, "email"), password: String(form.get("password") ?? "") });
  if (!result.ok) return failed(result);
  await keepSession(result.data.session);
  await rememberSignedIn(result.data.customer);
  const next = safeNext(form.get("next"));
  redirect(result.data.customer.email_verified ? next : `/verify?next=${encodeURIComponent(next)}`);
}

export async function signOut() {
  await customerApi("POST", "/v1/store/account/signout", {});
  await dropSession();
  await forgetSignedIn();
  revalidatePath("/", "layout");
  redirect("/");
}

/** The 6-digit code emailed at sign-up, for accounts that have not confirmed their email yet. */
export async function verifyEmail(_state: FormState, form: FormData): Promise<FormState> {
  const result = await customerApi<Customer>("POST", "/v1/store/account/email/verify", { code: text(form, "code") });
  if (!result.ok) return failed(result);
  redirect(safeNext(form.get("next")));
}

export async function resendCode(): Promise<FormState> {
  const result = await customerApi<Customer>("POST", "/v1/store/account/email/resend", {});
  return result.ok ? { notice: "We have sent you a new code." } : failed(result);
}
