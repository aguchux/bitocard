"use server";

import { revalidatePath } from "next/cache";
import { type ShopOrder, type ShopOrderMessage, type ShopStoreReport, type ShopStoreReportReason, storeReportReasonLabels } from "@bitocard/api-client/classifieds";
import { type CustomerResult, customerApi } from "./customer";
import type { ShopResult } from "./shop-actions";
import { uuidPattern } from "./shop";

/**
 * Buying on a Resale shop (B2B reselling, stage 4): the quote, buying from the store wallet (the money locked until the
 * supplier accepts), and the order chat with the store. The store's server adds the customer's session and names the
 * store; the API checks everything again. Safe pay's other buyer steps (cancel, confirm, dispute, the release code)
 * use the Shop tab's actions, which the API allows a Resale shop's buyer on their own orders.
 */

export type ResaleBuy = { ref: number; quantity: number; fulfilment: "meet_up" | "delivery"; delivery_address?: string; delivery_state_id?: string };

export type ResaleQuote = {
  object: "resale_order_quote";
  ref: number;
  quantity: number;
  currency: string;
  price: number;
  delivery_fee: number;
  buyer_fee: number;
  total: number;
  wallet_balance: number;
  enough: boolean;
  available: number;
  fulfilment: Array<"meet_up" | "delivery">;
  delivery: { state_id: string | null; within_state: number; nationwide: number | null } | null;
  phone_confirmed: boolean;
  accept_hours: number;
  covers: string[];
};

const refused = (message: string, param: string | null = null): ShopResult<never> => ({ ok: false, message, code: "parameter_invalid", param, signIn: false });

function answer<T>(result: CustomerResult<T>): ShopResult<T> {
  if (result.ok) return { ok: true, data: result.data };
  return { ok: false, message: result.status === 401 ? "Sign in again to carry on." : result.message, code: result.code, param: result.param, signIn: result.status === 401 };
}

/** Only what the API takes, checked here first so a slip never reaches it. */
function body(input: ResaleBuy) {
  if (!Number.isInteger(input.ref) || input.ref < 1) return null;
  if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 10) return null;
  if (input.fulfilment !== "meet_up" && input.fulfilment !== "delivery") return null;
  return {
    ref: input.ref,
    quantity: input.quantity,
    fulfilment: input.fulfilment,
    ...(input.fulfilment === "delivery" && input.delivery_address?.trim() ? { delivery_address: input.delivery_address.trim().slice(0, 500) } : {}),
    ...(input.fulfilment === "delivery" && input.delivery_state_id && uuidPattern.test(input.delivery_state_id) ? { delivery_state_id: input.delivery_state_id } : {}),
  };
}

export async function quoteResale(input: ResaleBuy): Promise<ShopResult<ResaleQuote>> {
  const sent = body(input);
  if (!sent) return refused("Choose how many and how you get it.");
  return answer(await customerApi<ResaleQuote>("POST", "/v1/store/resale/orders/quote", sent));
}

/** Buys at the total the buyer was shown (`price_changed` otherwise), once per form (`nonce`). */
export async function buyResale(input: ResaleBuy, expectedTotal: number, nonce: string): Promise<ShopResult<ShopOrder>> {
  const sent = body(input);
  if (!sent || !Number.isInteger(expectedTotal) || expectedTotal < 1) return refused("Choose how many and how you get it.");
  const result = answer(await customerApi<ShopOrder>("POST", "/v1/store/resale/orders", { ...sent, expected_total: expectedTotal }, { idempotencyKey: nonce }));
  if (result.ok) revalidatePath("/account/purchases");
  return result;
}

export async function loadPurchaseMessages(orderId: string, after?: string): Promise<ShopResult<{ data: ShopOrderMessage[] }>> {
  if (!uuidPattern.test(orderId) || (after && !uuidPattern.test(after))) return refused("No such order.");
  return answer(await customerApi<{ data: ShopOrderMessage[] }>("GET", `/v1/store/resale/orders/${orderId}/messages${after ? `?after=${after}` : ""}`));
}

export async function sendPurchaseMessage(orderId: string, text: string): Promise<ShopResult<ShopOrderMessage>> {
  if (!uuidPattern.test(orderId)) return refused("No such order.");
  if (!text.trim()) return refused("Write a message.", "body");
  return answer(await customerApi<ShopOrderMessage>("POST", `/v1/store/resale/orders/${orderId}/messages`, { body: text.trim().slice(0, 2000) }));
}

/**
 * Reports this Resale shop to BitoCard (B2B reselling, stage 5): claiming to own the items, saying what the supplier
 * did not, asking for payment outside BitoCard or misusing the buyer's details. One open report per store.
 */
export async function reportStore(reason: ShopStoreReportReason, details: string, orderId?: string): Promise<ShopResult<ShopStoreReport>> {
  if (!(reason in storeReportReasonLabels)) return refused("Choose what the store did.", "reason");
  const text = details.trim();
  if (text.length < 10) return refused("Say what happened, in at least 10 characters.", "details");
  if (orderId && !uuidPattern.test(orderId)) return refused("No such order.");
  return answer(await customerApi<ShopStoreReport>("POST", "/v1/store/resale/reports", { reason, details: text.slice(0, 2000), ...(orderId ? { order_id: orderId } : {}) }));
}
