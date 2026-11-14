"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { type AccessDelivery, type AccessOrder, accessApi, accessToken, passCookie, passPath } from "@/lib/access";

export type RevealState = { deliveries: AccessDelivery[] | null; error: string | null };
export type CodeState = { sent: string | null; error: string | null };

const tokenFrom = (form: FormData) => {
  const token = String(form.get("token") ?? "");
  return accessToken.test(token) ? token : null;
};

/** Reveal on an order's page, with the customer's proof (the API records the first reveal and alerts them). */
export async function revealCodes(_previous: RevealState, form: FormData): Promise<RevealState> {
  const token = tokenFrom(form);
  if (!token) return { deliveries: null, error: "This link is not valid." };
  const result = await accessApi<{ order: AccessOrder }>(token, "/reveal");
  if (!result.ok) return { deliveries: null, error: result.status === 401 ? "Your access has ended. Reload the page to confirm it is you again." : result.message };
  if (result.data.order.status !== "completed") return { deliveries: null, error: "This order has no codes to show." };
  return { deliveries: result.data.order.deliveries, error: null };
}

/** Emails a code to the order's address. */
export async function sendCode(_previous: CodeState, form: FormData): Promise<CodeState> {
  const token = tokenFrom(form);
  if (!token) return { sent: null, error: "This link is not valid." };
  const result = await accessApi<{ email_hint: string }>(token, "/code");
  if (!result.ok) return { sent: result.code === "code_recently_sent" ? "again" : null, error: result.message };
  return { sent: result.data.email_hint, error: null };
}

/** Checks the emailed code; the pass it gives opens this order's page on this device for 30 minutes. */
export async function verifyCode(_previous: CodeState, form: FormData): Promise<CodeState> {
  const token = tokenFrom(form);
  if (!token) return { sent: null, error: "This link is not valid." };
  const code = String(form.get("code") ?? "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) return { sent: "again", error: "Enter the 6 digits we emailed you." };
  const result = await accessApi<{ pass: string; expires_at: string }>(token, "/verify", { code });
  if (!result.ok) return { sent: "again", error: result.message };
  (await cookies()).set(passCookie, result.data.pass, {
    path: passPath(token),
    expires: new Date(result.data.expires_at),
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  redirect(passPath(token));
}
