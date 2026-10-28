"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FormState, NonceFormState } from "@afrippa/ui/forms";
import { toMinor } from "@afrippa/ui/trade-actions";
import { customerApi, safeNext, signInPath } from "@/lib/customer";
import type { Order, OrderMessage, OrderMessages, PaymentMethod } from "@/lib/orders-types";

/**
 * Afrippa's order and payment-method actions, over the trader's own session and signed by this server: saving where
 * they are paid, opening an order on an ad, each step of the escrow, and the order room. A refused session signs in
 * first and comes back.
 */

const text = (form: FormData, name: string) => String(form.get(name) ?? "").trim();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const idOf = (form: FormData, name = "id") => (uuid.test(text(form, name)) ? text(form, name) : null);
const nonce = () => crypto.randomUUID();

/** A refusal: a lost session signs in again (back to `next`), anything else is the API's message on the form. */
function refused(result: { status: number; message: string; param: string | null }, next: string): FormState {
  if (result.status === 401) redirect(signInPath(next));
  return { error: result.message, field: result.param };
}

// Payment methods

/** Saves where the trader is paid: a bank account, a mobile money wallet or a named service, in one currency. */
export async function addPaymentMethod(_state: FormState, form: FormData): Promise<FormState> {
  const kind = text(form, "kind");
  if (kind !== "bank" && kind !== "mobile_money" && kind !== "named") return { error: "Choose what kind of account it is.", field: "kind" };
  const fields: Record<string, string[]> = { bank: ["bank_name", "bank_code", "account_number"], mobile_money: ["network", "phone"], named: ["provider", "handle"] };
  const body: Record<string, string> = { kind, currency: text(form, "currency").toUpperCase() };
  for (const name of fields[kind]) if (text(form, name)) body[name] = text(form, name);
  const result = await customerApi<PaymentMethod>("POST", "/v1/afrippa/p2p/payment-methods", body, { idempotencyKey: text(form, "nonce") || undefined });
  if (!result.ok) return refused(result, "/payment-methods");
  revalidatePath("/payment-methods");
  return { notice: `${result.data.label} ${result.data.hint} is saved. You can use it from ${new Date(result.data.usable_from).toUTCString()}.` };
}

export async function removePaymentMethod(_state: FormState, form: FormData): Promise<FormState> {
  const id = idOf(form);
  if (!id) return { error: "Choose a payment method." };
  const result = await customerApi("DELETE", `/v1/afrippa/p2p/payment-methods/${id}`);
  if (!result.ok) return refused(result, "/payment-methods");
  revalidatePath("/payment-methods");
  return {};
}

// Opening an order

/**
 * Opens an order on an ad, at the price the trader saw and for the amount they typed (money for a sell ad they buy
 * from, or either). The form's nonce is its Idempotency-Key, so a double submit opens one order.
 */
export async function openOrder(state: NonceFormState, form: FormData): Promise<NonceFormState> {
  const ad = idOf(form, "ad_id");
  const method = idOf(form, "payment_method_id");
  const price = Number(text(form, "price"));
  const fiat = toMinor(text(form, "fiat"));
  const back = `/take/${ad ?? ""}`;
  if (!ad) return { error: "Choose an ad.", nonce: nonce() };
  if (!method) return { error: "Choose where the money is paid.", field: "payment_method_id", nonce: state.nonce };
  if (!fiat) return { error: "Enter how much to trade.", field: "fiat", nonce: state.nonce };
  if (!Number.isInteger(price) || price < 1) return { error: "Choose the ad again: its price was not read.", nonce: state.nonce };
  const result = await customerApi<Order>("POST", "/v1/afrippa/p2p/orders", { ad_id: ad, price, fiat, payment_method_id: method }, { idempotencyKey: text(form, "nonce") || undefined });
  if (!result.ok) return { ...refused(result, back), nonce: nonce() };
  revalidatePath("/orders");
  redirect(`/orders/${result.data.id}`);
}

// The escrow's steps

/** One step of an order, then back to its page; a refusal shows on the form. */
async function step(form: FormData, path: string, body: Record<string, unknown> = {}): Promise<FormState> {
  const id = idOf(form);
  if (!id) return { error: "Choose an order." };
  // Each step is claimed on the order's status by the API, so repeating one is refused, never done twice: no nonce.
  const result = await customerApi<Order>("POST", `/v1/afrippa/p2p/orders/${id}/${path}`, body);
  if (!result.ok) return refused(result, `/orders/${id}`);
  revalidatePath(`/orders/${id}`);
  revalidatePath("/orders");
  return { notice: "Done." };
}

/** The buyer paid, naming their own account the money came from. */
export async function markPaid(_state: FormState, form: FormData): Promise<FormState> {
  const from = idOf(form, "payment_method_id");
  if (!from) return { error: "Choose the account you paid from.", field: "payment_method_id" };
  return step(form, "paid", { payment_method_id: from });
}

/** The seller releases the coins, once they checked the money arrived from the buyer's own name. */
export async function releaseOrder(_state: FormState, form: FormData): Promise<FormState> {
  if (form.get("payer_checked") !== "yes") return { error: "Confirm the money arrived from the buyer’s own account first.", field: "payer_checked" };
  return step(form, "release", { payer_checked: true });
}

/** The buyer cancels (before paying, or if they will not pay): the coins go back to the seller. */
export async function cancelOrder(_state: FormState, form: FormData): Promise<FormState> {
  if (form.get("confirm") !== "yes") return { error: "Confirm you have not paid, or will not pay." };
  return step(form, "cancel");
}

/** Either side asks Afrippa's team to decide, once the order is marked paid. */
export async function appealOrder(_state: FormState, form: FormData): Promise<FormState> {
  const reason = text(form, "reason");
  if (reason.length < 10) return { error: "Tell us what happened, in at least 10 characters.", field: "reason" };
  return step(form, "appeal", { reason });
}

// The order room

/** The room's messages since `after` (all of them without it), for the page's polling; null when it cannot be read. */
export async function roomSince(orderId: string, after: string | null): Promise<OrderMessages | null> {
  if (!uuid.test(orderId) || (after !== null && !uuid.test(after))) return null;
  const result = await customerApi<OrderMessages>("GET", `/v1/afrippa/p2p/orders/${orderId}/messages${after ? `?after=${after}` : ""}`);
  return result.ok ? result.data : null;
}

export type RoomState = FormState & { sent?: OrderMessage };

/** Writes in the room: text, or a photo or PDF (with an optional caption), read here and sent on as base64. */
export async function sendToRoom(_state: RoomState, form: FormData): Promise<RoomState> {
  const id = idOf(form);
  if (!id) return { error: "Choose an order." };
  const body = text(form, "body");
  const file = form.get("file");
  let result;
  if (file instanceof File && file.size > 0) {
    if (!["image/jpeg", "image/png", "application/pdf"].includes(file.type)) return { error: "Send a photo (JPEG or PNG) or a PDF.", field: "file" };
    if (file.size > 4 * 1024 * 1024) return { error: "Files can be up to 4 MB.", field: "file" };
    const data = Buffer.from(await file.arrayBuffer()).toString("base64");
    result = await customerApi<OrderMessage>("POST", `/v1/afrippa/p2p/orders/${id}/attachments`, { file_name: file.name.slice(0, 200) || "file", content_type: file.type, data, ...(body ? { body } : {}) });
  } else {
    if (!body) return { error: "Write a message.", field: "body" };
    result = await customerApi<OrderMessage>("POST", `/v1/afrippa/p2p/orders/${id}/messages`, { body });
  }
  if (!result.ok) return refused(result, `/orders/${id}`);
  return { sent: result.data };
}

// Trust: feedback, blocks and reports

const nickname = (form: FormData) => (/^[A-Za-z0-9_]{3,30}$/.test(text(form, "nickname")) ? text(form, "nickname") : null);

/** Rates the other party once the order is released (once, within 30 days); comments carry no contact details. */
export async function giveFeedback(_state: FormState, form: FormData): Promise<FormState> {
  const id = idOf(form);
  const rating = text(form, "rating");
  if (!id) return { error: "Choose an order." };
  if (rating !== "positive" && rating !== "negative") return { error: "Choose positive or negative.", field: "rating" };
  const comment = text(form, "comment");
  const result = await customerApi("POST", `/v1/afrippa/p2p/orders/${id}/feedback`, { rating, ...(comment ? { comment } : {}) });
  if (!result.ok) return refused(result, `/orders/${id}`);
  revalidatePath(`/orders/${id}`);
  return { notice: "Thank you: your feedback is on their card." };
}

/** Blocks a trader: neither sees the other's ads or can open an order on them. */
export async function blockTrader(_state: FormState, form: FormData): Promise<FormState> {
  const who = nickname(form);
  if (!who) return { error: "Choose a trader." };
  const result = await customerApi("POST", "/v1/afrippa/p2p/blocks", { nickname: who });
  if (!result.ok) return refused(result, `/trader/${who}`);
  revalidatePath("/trust");
  revalidatePath(`/trader/${who}`);
  return { notice: `${who} is blocked. You will not see each other's ads.` };
}

export async function unblockTrader(_state: FormState, form: FormData): Promise<FormState> {
  const who = nickname(form);
  if (!who) return { error: "Choose a trader." };
  const result = await customerApi("DELETE", `/v1/afrippa/p2p/blocks/${encodeURIComponent(who)}`);
  if (!result.ok) return refused(result, "/trust");
  revalidatePath("/trust");
  revalidatePath(`/trader/${who}`);
  return { notice: `${who} is no longer blocked.` };
}

/** Reports a trader to Afrippa's team (optionally on an order between them); one open report each. */
export async function reportTrader(_state: FormState, form: FormData): Promise<FormState> {
  const who = nickname(form);
  const details = text(form, "details");
  if (!who) return { error: "Choose a trader." };
  if (details.length < 10) return { error: "Tell us what happened, in at least 10 characters.", field: "details" };
  const order = idOf(form, "order_id");
  const result = await customerApi<{ number: string }>("POST", "/v1/afrippa/p2p/reports", { nickname: who, reason: text(form, "reason"), details, ...(order ? { order_id: order } : {}) });
  if (!result.ok) return refused(result, "/trust");
  revalidatePath("/trust");
  return { notice: `Report ${result.data.number} is with Afrippa's team. We will tell you what we decide.` };
}

// Notifications

/** Opens a notice: marked read, then to the page it names on this site (never another site). */
export async function openNotification(form: FormData): Promise<void> {
  const id = idOf(form);
  if (id) await customerApi("POST", `/v1/afrippa/account/notifications/${id}/read`, {});
  revalidatePath("/", "layout");
  redirect(safeNext(form.get("link"), "/notifications"));
}

export async function readAllNotifications(): Promise<void> {
  await customerApi("POST", "/v1/afrippa/account/notifications/read-all", {});
  revalidatePath("/", "layout");
}
