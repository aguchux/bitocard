"use server";

import type { ShopChat, ShopMessage, ShopOrder, ShopPhone, ShopReportReason } from "@bitocard/api-client/classifieds";
import { type CustomerResult, customerApi } from "@/lib/customer";

/** What a listing action answers: its data, or why not (`signIn` when the session has ended). */
export type ActionResult<T> = { ok: true; data: T } | { ok: false; message: string; code: string | null; signIn: boolean };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const refused = (message: string): ActionResult<never> => ({ ok: false, message, code: "parameter_invalid", signIn: false });

function answer<T>(result: CustomerResult<T>): ActionResult<T> {
  if (result.ok) return { ok: true, data: result.data };
  return { ok: false, message: result.status === 401 ? "Sign in again to carry on." : result.message, code: result.code, signIn: result.status === 401 };
}

/** Saves a listing to the customer's favourites, or takes it off. */
export async function saveListing(listingId: string, save: boolean): Promise<ActionResult<{ favourite: boolean }>> {
  if (!uuid.test(listingId)) return refused("No such listing.");
  const result = save ? await customerApi("POST", "/v1/classifieds/favourites", { listing_id: listingId }) : await customerApi("DELETE", `/v1/classifieds/favourites/${listingId}`);
  return result.ok ? { ok: true, data: { favourite: save } } : answer(result);
}

/** The seller's confirmed number (where the listing takes calls); each buyer counts once as a lead. */
export async function showPhone(listingId: string): Promise<ActionResult<ShopPhone>> {
  if (!uuid.test(listingId)) return refused("No such listing.");
  return answer(await customerApi<ShopPhone>("POST", `/v1/classifieds/listings/${listingId}/phone`, {}));
}

/** Reports a listing to BitoCard's moderators. */
export async function reportListing(listingId: string, reason: ShopReportReason, details: string): Promise<ActionResult<{ id: string }>> {
  if (!uuid.test(listingId)) return refused("No such listing.");
  return answer(await customerApi<{ id: string }>("POST", "/v1/classifieds/reports", { listing_id: listingId, reason, ...(details.trim() ? { details: details.trim().slice(0, 1000) } : {}) }));
}

/** The buyer's first message opens the chat (or continues theirs); the form's nonce makes a double send act once. */
export async function startChat(listingId: string, body: string, nonce?: string): Promise<ActionResult<ShopChat>> {
  if (!uuid.test(listingId)) return refused("No such listing.");
  if (!body.trim()) return refused("Write a message.");
  return answer(await customerApi<ShopChat>("POST", "/v1/classifieds/conversations", { listing_id: listingId, body }, { idempotencyKey: nonce }));
}

export async function sendMessage(chatId: string, body: string, nonce?: string): Promise<ActionResult<ShopMessage>> {
  if (!uuid.test(chatId)) return refused("No such chat.");
  if (!body.trim()) return refused("Write a message.");
  return answer(await customerApi<ShopMessage>("POST", `/v1/classifieds/conversations/${chatId}/messages`, { body }, { idempotencyKey: nonce }));
}

/** The chat, or only what came after `after` (polling while it is open). */
export async function loadChat(chatId: string, after?: string): Promise<ActionResult<ShopChat>> {
  if (!uuid.test(chatId) || (after && !uuid.test(after))) return refused("No such chat.");
  return answer(await customerApi<ShopChat>("GET", `/v1/classifieds/conversations/${chatId}${after ? `?after=${after}` : ""}`));
}

/** An offer in the chat, in the currency's main unit as typed (naira), sent in minor units. */
export async function makeOffer(chatId: string, amount: string, nonce?: string): Promise<ActionResult<ShopMessage>> {
  if (!uuid.test(chatId)) return refused("No such chat.");
  const major = Number(amount.replace(/[,\s]/g, ""));
  if (!Number.isFinite(major) || major <= 0 || major > 10_000_000_000_000) return refused("Give your offer as an amount.");
  return answer(await customerApi<ShopMessage>("POST", `/v1/classifieds/conversations/${chatId}/offers`, { price: Math.round(major * 100) }, { idempotencyKey: nonce }));
}

/** Accepts or declines the other side's offer, or withdraws one's own. */
export async function answerOffer(offerId: string, action: "accept" | "decline" | "withdraw"): Promise<ActionResult<unknown>> {
  if (!uuid.test(offerId) || !["accept", "decline", "withdraw"].includes(action)) return refused("No such offer.");
  return answer(await customerApi("POST", `/v1/classifieds/offers/${offerId}/${action}`, {}));
}

/** Asks to buy with Safe pay: the listed price or an accepted offer, a meet-up or a delivery. */
export async function requestSafePay(input: { listingId: string; offerId?: string | null; fulfilment: "meet_up" | "delivery"; address?: string; nonce?: string }): Promise<ActionResult<ShopOrder>> {
  if (!uuid.test(input.listingId) || (input.offerId && !uuid.test(input.offerId))) return refused("No such listing.");
  if (!["meet_up", "delivery"].includes(input.fulfilment)) return refused("Choose how you will get it.");
  return answer(
    await customerApi<ShopOrder>(
      "POST",
      "/v1/classifieds/orders",
      { listing_id: input.listingId, ...(input.offerId ? { offer_id: input.offerId } : {}), fulfilment: input.fulfilment, ...(input.fulfilment === "delivery" ? { delivery_address: (input.address ?? "").trim() } : {}) },
      { idempotencyKey: input.nonce },
    ),
  );
}

/** Pays an accepted Safe pay order from the wallet (BitoCard holds the money until the hand-over). */
export async function paySafePay(orderId: string, nonce?: string): Promise<ActionResult<ShopOrder>> {
  if (!uuid.test(orderId)) return refused("No such order.");
  return answer(await customerApi<ShopOrder>("POST", `/v1/classifieds/orders/${orderId}/pay`, {}, { idempotencyKey: nonce }));
}

/** Cancels the buyer's request or order (before the hand-over; once paid, the money comes back in full). */
export async function cancelSafePay(orderId: string): Promise<ActionResult<ShopOrder>> {
  if (!uuid.test(orderId)) return refused("No such order.");
  return answer(await customerApi<ShopOrder>("POST", `/v1/classifieds/orders/${orderId}/cancel`, {}));
}
