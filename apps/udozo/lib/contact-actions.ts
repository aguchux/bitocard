"use server";

import { customerApi } from "./customer";
import { isContactKind } from "./help";

export type ContactSent = { reference: string };
export type ContactForm = { kind: string; name: string; email: string; phone: string; body: string; country: string | null; nonce: string };
export type ContactResult = { ok: true; data: ContactSent } | { ok: false; message: string; field: "kind" | "name" | "email" | "phone" | "body" | null };

const fields = ["kind", "name", "email", "phone", "body"] as const;

/**
 * Sends the Contact us form to Udozo's support team (with the signed-in customer's account, when there is one), once
 * per form (its nonce is the Idempotency-Key). The API checks every field; its refusal names the field to fix.
 */
export async function sendContact(form: ContactForm): Promise<ContactResult> {
  if (!isContactKind(form.kind)) return { ok: false, message: "Choose what your message is about.", field: "kind" };
  const country = form.country && /^[A-Za-z]{2}$/.test(form.country) ? form.country.toUpperCase() : undefined;
  const result = await customerApi<ContactSent>(
    "POST",
    "/v1/contact-messages",
    { kind: form.kind, name: form.name.trim(), email: form.email.trim(), ...(form.phone.trim() ? { phone: form.phone.trim() } : {}), body: form.body.trim(), ...(country ? { country } : {}) },
    { idempotencyKey: form.nonce },
  );
  if (result.ok) return { ok: true, data: { reference: result.data.reference } };
  const field = fields.find(name => name === result.param) ?? null;
  return { ok: false, message: result.status === 400 && !field ? "Check the form and try again." : result.message, field };
}
