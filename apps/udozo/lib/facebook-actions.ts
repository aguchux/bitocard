"use server";

import { redirect } from "next/navigation";
import { customerApi, safeNext } from "@/lib/customer";
import { keepFacebookFlow } from "@/lib/facebook";
import { cleanRef } from "@/lib/invite";

/**
 * "Continue with Facebook": asks the API for Facebook's address and a one-time state, keeps the state in this browser,
 * and sends the browser to Facebook. A Facebook account no account uses yet signs up when Facebook returns.
 */
export async function continueWithFacebook(form: FormData) {
  const intent = form.get("intent") === "signup" ? "signup" : "signin";
  const next = safeNext(form.get("next"));
  const page = intent === "signup" ? "/signup" : "/signin";
  const result = await customerApi<{ url: string; state: string }>("POST", "/v1/store/account/facebook/start", { intent });
  if (!result.ok) redirect(`${page}?next=${encodeURIComponent(next)}&auth_error=${encodeURIComponent(result.code === "facebook_not_configured" ? result.code : "facebook_failed")}`);
  // Only ever Facebook's own consent page.
  const url = new URL(result.data.url);
  if (url.protocol !== "https:" && process.env.NODE_ENV === "production") redirect(`${page}?auth_error=facebook_failed`);
  await keepFacebookFlow({ state: result.data.state, intent, next, ref: cleanRef(String(form.get("ref") ?? "")) ?? null });
  redirect(url.toString());
}
