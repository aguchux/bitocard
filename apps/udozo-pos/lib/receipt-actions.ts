"use server";

import { revalidatePath } from "next/cache";
import type { PosReceiptCode, PosReceiptSend, ReceiptKind } from "./pos";
import { posApi } from "./pos-api";
import type { ApiResult } from "./session";

/** What a receipt action answers: what was sent or shown, or Udozo's refusal in words with the field it names. */
export type ReceiptResult<T> = { ok: true; data: T } | { ok: false; message: string; code: string | null; param: string | null };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const refused = (message: string, param: string | null = null): ReceiptResult<never> => ({ ok: false, message, code: "parameter_invalid", param });
const kindOf = (kind: unknown): ReceiptKind => (kind === "invoice" ? "invoice" : "receipt");

function answer<T>(result: ApiResult<T>, saleId?: string): ReceiptResult<T> {
  if (!result.ok) return { ok: false, message: result.status === 401 ? "Your session ended. Sign in again to carry on." : result.message, code: result.code, param: result.param };
  if (saleId) revalidatePath(`/app/sales/${saleId}`, "layout");
  return { ok: true, data: result.data };
}

/** A code to show as a QR at the till: the customer scans it and gets the PDF on WhatsApp (10 minutes). */
export async function showReceiptCode(saleId: string, kind: ReceiptKind = "receipt"): Promise<ReceiptResult<PosReceiptCode>> {
  if (!uuid.test(saleId)) return refused("No such sale.");
  return answer(await posApi<PosReceiptCode>("POST", `/sales/${saleId}/receipt-codes`, { kind: kindOf(kind) }));
}

/** Whether the customer has had it yet (asked every few seconds while the QR code is shown). */
export async function receiptCodeStatus(saleId: string, codeId: string): Promise<ReceiptResult<PosReceiptCode>> {
  if (!uuid.test(saleId) || !uuid.test(codeId)) return refused("No such receipt code.");
  return answer(await posApi<PosReceiptCode>("GET", `/sales/${saleId}/receipt-codes/${codeId}`));
}

/** The PDF to the customer's WhatsApp: at once inside WhatsApp's 24-hour window, else a message whose button brings it. */
export async function sendReceiptWhatsapp(saleId: string, input: { phone: string; kind?: ReceiptKind; save?: boolean }): Promise<ReceiptResult<PosReceiptSend>> {
  if (!uuid.test(saleId)) return refused("No such sale.");
  const phone = input.phone.replace(/[\s()-]/g, "");
  if (!/^\+?\d{7,15}$/.test(phone)) return refused("Enter their mobile number.", "phone");
  return answer(await posApi<PosReceiptSend>("POST", `/sales/${saleId}/receipt/whatsapp`, { phone, kind: kindOf(input.kind), ...(input.save ? { save_to_customer: true } : {}) }), saleId);
}

/** The receipt, the invoice or both to an email address, attached as PDFs. */
export async function sendReceiptEmail(saleId: string, input: { email: string; attach?: ReceiptKind | "both"; save?: boolean }): Promise<ReceiptResult<PosReceiptSend>> {
  if (!uuid.test(saleId)) return refused("No such sale.");
  const email = input.email.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254) return refused("Enter a valid email address.", "email");
  const attach = input.attach === "both" || input.attach === "invoice" ? input.attach : "receipt";
  return answer(await posApi<PosReceiptSend>("POST", `/sales/${saleId}/receipt/email`, { email, attach, ...(input.save ? { save_to_customer: true } : {}) }), saleId);
}
