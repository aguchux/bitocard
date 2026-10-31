"use server";

import { redirect } from "next/navigation";
import { customerApi, safeNext } from "@/lib/customer";
import { keepGoogleFlow } from "@/lib/google";
import { cleanRef } from "@/lib/invite";

/**
 * "Continue with Google": asks the API for Google's address and a one-time state, keeps the state in this browser, and
 * sends the browser to Google. `intent=signup` makes the account when Google returns; `signin` only signs one in.
 */
export async function continueWithGoogle(form: FormData) {
  const intent = form.get("intent") === "signup" ? "signup" : "signin";
  const next = safeNext(form.get("next"));
  const page = intent === "signup" ? "/signup" : "/signin";
  const result = await customerApi<{ url: string; state: string }>("POST", "/v1/store/account/google/start", { intent });
  if (!result.ok) redirect(`${page}?next=${encodeURIComponent(next)}&auth_error=${encodeURIComponent(result.code ?? "google_failed")}`);
  // Only ever Google's own consent page.
  const url = new URL(result.data.url);
  if (url.protocol !== "https:" && process.env.NODE_ENV === "production") redirect(`${page}?auth_error=google_failed`);
  await keepGoogleFlow({ state: result.data.state, intent, next, ref: cleanRef(String(form.get("ref") ?? "")) ?? null });
  redirect(url.toString());
}
