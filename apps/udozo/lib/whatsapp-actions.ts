"use server";

import { revalidatePath } from "next/cache";
import { customerApi } from "@/lib/customer";
import { type WhatsappConnection, type WhatsappLink, whatsappErrorText, whatsappScreen } from "@/lib/whatsapp";

/**
 * Profile > WhatsApp for the signed-in customer: a one-time code to send from their number, their choices and
 * disconnecting. The browser only ever calls these; they call the API with the customer's session.
 */

export type LinkResult = { ok: true; data: WhatsappLink } | { ok: false; message: string };
export type ConnectionResult = { ok: true; data: WhatsappConnection } | { ok: false; message: string };

export async function startWhatsappLink(): Promise<LinkResult> {
  const result = await customerApi<WhatsappLink>("POST", "/v1/store/account/whatsapp/link");
  return result.ok ? { ok: true, data: result.data } : { ok: false, message: whatsappErrorText(result) };
}

/** Reads it again (after they sent the code from WhatsApp). */
export async function whatsappStatus(): Promise<ConnectionResult> {
  const result = await customerApi<WhatsappConnection>("GET", "/v1/store/account/whatsapp");
  return result.ok ? { ok: true, data: result.data } : { ok: false, message: whatsappErrorText(result) };
}

export type WhatsappChoices = { chats?: boolean; alerts?: boolean; direct?: boolean };

export async function setWhatsappChoices(input: WhatsappChoices): Promise<ConnectionResult> {
  const body = Object.fromEntries((["chats", "alerts", "direct"] as const).filter(key => typeof input[key] === "boolean").map(key => [key, input[key]]));
  const result = await customerApi<WhatsappConnection>("PATCH", "/v1/store/account/whatsapp", body);
  if (!result.ok) return { ok: false, message: whatsappErrorText(result) };
  revalidatePath(whatsappScreen);
  return { ok: true, data: result.data };
}

export async function disconnectWhatsapp(): Promise<ConnectionResult> {
  const result = await customerApi<WhatsappConnection>("DELETE", "/v1/store/account/whatsapp");
  if (!result.ok) return { ok: false, message: whatsappErrorText(result) };
  revalidatePath(whatsappScreen);
  return { ok: true, data: result.data };
}
