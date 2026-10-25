"use server";

import { revalidatePath } from "next/cache";
import type {
  ShopChat,
  ShopContact,
  ShopCondition,
  ShopDelivery,
  ShopDispute,
  ShopDisputeMessage,
  ShopDisputeReason,
  ShopFeature,
  ShopMessage,
  ShopMyListing,
  ShopOrder,
  ShopPriceKind,
  ShopReleaseCode,
  ShopReportReason,
  ShopVideoUpload,
} from "@bitocard/api-client/classifieds";
import { apiUrl } from "./api";
import { type CustomerResult, customerApi } from "./customer";
import { toMinor, uuidPattern } from "./shop";

/** What a Shop action answers: its data, or why not (`param` names the field, `signIn` when the session has ended). */
export type ShopResult<T> = { ok: true; data: T } | { ok: false; message: string; code: string | null; param: string | null; signIn: boolean };

const refused = (message: string, param: string | null = null): ShopResult<never> => ({ ok: false, message, code: "parameter_invalid", param, signIn: false });

function answer<T>(result: CustomerResult<T>): ShopResult<T> {
  if (result.ok) return { ok: true, data: result.data };
  return { ok: false, message: result.status === 401 ? "Sign in again to carry on." : result.message, code: result.code, param: result.param, signIn: result.status === 401 };
}

const id = (value: string) => uuidPattern.test(value);

// ---- Listings ----

/** The fields the Post an ad form saves as the seller goes (every one optional; null clears it). */
export type ListingFields = Partial<{
  title: string | null;
  description: string | null;
  category_id: string | null;
  area_id: string | null;
  price_kind: ShopPriceKind;
  /** As typed, in the currency's main unit ("520,000"); empty clears it. */
  price: string;
  condition: ShopCondition | null;
  delivery: ShopDelivery;
  contact: ShopContact;
  features: Array<{ key: string; value: string | number | boolean | null }>;
}>;

function body(fields: ListingFields): { body: Record<string, unknown> } | { problem: ShopResult<never> } {
  const out: Record<string, unknown> = {};
  for (const key of ["title", "description", "category_id", "area_id", "price_kind", "condition", "delivery", "contact"] as const) {
    if (fields[key] !== undefined) out[key] = typeof fields[key] === "string" ? (fields[key] as string).trim() || null : fields[key];
  }
  if (fields.price !== undefined) {
    if (!fields.price.trim()) out.price = null;
    else {
      const minor = toMinor(fields.price);
      if (minor === null) return { problem: refused("Give the price as an amount, such as 520,000.", "price") };
      out.price = minor;
    }
  }
  if (fields.features) out.features = fields.features.filter(item => item.value !== null && item.value !== "");
  return { body: out };
}

/** A new draft with the first fields the seller gave (it is created on their first change, never by opening the page). */
export async function createListing(fields: ListingFields, nonce?: string): Promise<ShopResult<ShopMyListing>> {
  const made = body(fields);
  if ("problem" in made) return made.problem;
  return answer(await customerApi<ShopMyListing>("POST", "/v1/classifieds/listings", made.body, { idempotencyKey: nonce }));
}

export async function updateListing(listingId: string, fields: ListingFields): Promise<ShopResult<ShopMyListing>> {
  if (!id(listingId)) return refused("No such listing.");
  const made = body(fields);
  if ("problem" in made) return made.problem;
  return answer(await customerApi<ShopMyListing>("PATCH", `/v1/classifieds/listings/${listingId}`, made.body));
}

export async function loadListing(listingId: string): Promise<ShopResult<ShopMyListing>> {
  if (!id(listingId)) return refused("No such listing.");
  return answer(await customerApi<ShopMyListing>("GET", `/v1/classifieds/me/listings/${listingId}`));
}

/** Posts the listing: live at once, or to BitoCard's review first. */
export async function submitListing(listingId: string): Promise<ShopResult<ShopMyListing>> {
  if (!id(listingId)) return refused("No such listing.");
  const result = answer(await customerApi<ShopMyListing>("POST", `/v1/classifieds/listings/${listingId}/submit`, {}));
  if (result.ok) revalidatePath("/shop");
  return result;
}

/** Renews an expired listing, marks a live one sold, or deletes one (My listings' buttons). */
export async function listingAction(listingId: string, action: "renew" | "sold" | "delete"): Promise<ShopResult<unknown>> {
  if (!id(listingId) || !["renew", "sold", "delete"].includes(action)) return refused("No such listing.");
  const result = answer(action === "delete" ? await customerApi("DELETE", `/v1/classifieds/listings/${listingId}`) : await customerApi("POST", `/v1/classifieds/listings/${listingId}/${action}`, {}));
  if (result.ok) revalidatePath("/shop");
  return result;
}

/** The photos in their new order: the first is the cover. */
export async function reorderPhotos(listingId: string, order: string[]): Promise<ShopResult<unknown>> {
  if (!id(listingId) || !order.length || order.length > 20 || !order.every(id)) return refused("No such photos.");
  return answer(await customerApi("PATCH", `/v1/classifieds/listings/${listingId}/photos`, { order }));
}

export async function removeMedia(listingId: string, mediaId: string): Promise<ShopResult<unknown>> {
  if (!id(listingId) || !id(mediaId)) return refused("No such photo.");
  return answer(await customerApi("DELETE", `/v1/classifieds/listings/${listingId}/media/${mediaId}`));
}

/**
 * Where the browser sends the video itself (a 15-minute link to the API: this server cannot pass 50 MB on). The link
 * is the only credential it carries.
 */
export async function videoUploadUrl(listingId: string): Promise<ShopResult<{ url: string }>> {
  if (!id(listingId)) return refused("No such listing.");
  const result = answer(await customerApi<ShopVideoUpload>("POST", `/v1/classifieds/listings/${listingId}/video-upload`, {}));
  return result.ok ? { ok: true, data: { url: apiUrl(result.data.path) } } : result;
}

/** The feature registry, searched by name and search words ("ram" finds Memory). */
export async function searchFeatures(q: string): Promise<ShopResult<ShopFeature[]>> {
  const words = q.trim().slice(0, 60);
  if (words.length < 2) return { ok: true, data: [] };
  const result = answer(await customerApi<{ data: ShopFeature[] }>("GET", `/v1/classifieds/features?q=${encodeURIComponent(words)}`));
  return result.ok ? { ok: true, data: result.data.data.slice(0, 12) } : result;
}

/** Asks BitoCard to add a feature the registry does not have. */
export async function suggestFeature(name: string, categoryId: string | null): Promise<ShopResult<unknown>> {
  const text = name.trim().slice(0, 60);
  if (text.length < 2) return refused("Name the feature.", "name");
  if (categoryId && !id(categoryId)) return refused("No such category.");
  return answer(await customerApi("POST", "/v1/classifieds/feature-suggestions", { name: text, ...(categoryId ? { category_id: categoryId } : {}) }));
}

// ---- Chats ----

export async function loadChat(chatId: string, after?: string): Promise<ShopResult<ShopChat>> {
  if (!id(chatId) || (after && !id(after))) return refused("No such chat.");
  return answer(await customerApi<ShopChat>("GET", `/v1/classifieds/conversations/${chatId}${after ? `?after=${after}` : ""}`));
}

export async function sendMessage(chatId: string, text: string, nonce?: string): Promise<ShopResult<ShopMessage>> {
  if (!id(chatId)) return refused("No such chat.");
  if (!text.trim()) return refused("Write a message.");
  return answer(await customerApi<ShopMessage>("POST", `/v1/classifieds/conversations/${chatId}/messages`, { body: text.slice(0, 2000) }, { idempotencyKey: nonce }));
}

/** An offer in the chat, typed in the currency's main unit (naira) and sent in minor units. */
export async function makeOffer(chatId: string, amount: string, nonce?: string): Promise<ShopResult<ShopMessage>> {
  if (!id(chatId)) return refused("No such chat.");
  const minor = toMinor(amount);
  if (minor === null) return refused("Give your offer as an amount.");
  return answer(await customerApi<ShopMessage>("POST", `/v1/classifieds/conversations/${chatId}/offers`, { price: minor }, { idempotencyKey: nonce }));
}

export async function answerOffer(offerId: string, action: "accept" | "decline" | "withdraw"): Promise<ShopResult<unknown>> {
  if (!id(offerId) || !["accept", "decline", "withdraw"].includes(action)) return refused("No such offer.");
  return answer(await customerApi("POST", `/v1/classifieds/offers/${offerId}/${action}`, {}));
}

/** Blocks the other person in this chat (neither side can write while it lasts), or lifts it. */
export async function blockChat(chatId: string, block: boolean): Promise<ShopResult<unknown>> {
  if (!id(chatId)) return refused("No such chat.");
  return answer(await customerApi("POST", `/v1/classifieds/conversations/${chatId}/${block ? "block" : "unblock"}`, {}));
}

export async function reportChat(chatId: string, reason: ShopReportReason, details: string): Promise<ShopResult<unknown>> {
  if (!id(chatId)) return refused("No such chat.");
  return answer(await customerApi("POST", `/v1/classifieds/conversations/${chatId}/report`, { reason, ...(details.trim() ? { details: details.trim().slice(0, 1000) } : {}) }));
}

// ---- Safe pay orders ----

type OrderStep = "accept" | "decline" | "pay" | "sent" | "received" | "cancel";

/** A step on an order: the seller accepts or declines, the buyer pays or confirms it arrived, the seller marks it sent, either side cancels. */
export async function orderStep(orderId: string, step: OrderStep, input: { reason?: string; tracking_note?: string; nonce?: string } = {}): Promise<ShopResult<ShopOrder>> {
  if (!id(orderId) || !["accept", "decline", "pay", "sent", "received", "cancel"].includes(step)) return refused("No such order.");
  const sent: Record<string, string> = {};
  if ((step === "decline" || step === "cancel") && input.reason?.trim()) sent.reason = input.reason.trim().slice(0, 500);
  if (step === "sent" && input.tracking_note?.trim()) sent.tracking_note = input.tracking_note.trim().slice(0, 500);
  const result = answer(await customerApi<ShopOrder>("POST", `/v1/classifieds/orders/${orderId}/${step}`, sent, { idempotencyKey: input.nonce }));
  if (result.ok) revalidatePath(`/shop/orders/${orderId}`);
  return result;
}

/** The buyer's release code for a meet-up (only ever shown to them). */
export async function releaseCode(orderId: string): Promise<ShopResult<ShopReleaseCode>> {
  if (!id(orderId)) return refused("No such order.");
  return answer(await customerApi<ShopReleaseCode>("GET", `/v1/classifieds/orders/${orderId}/release-code`));
}

/** The seller enters the buyer's 6-digit code at the meet-up: the money is released at once. */
export async function enterReleaseCode(orderId: string, code: string): Promise<ShopResult<ShopOrder>> {
  if (!id(orderId)) return refused("No such order.");
  if (!/^\d{6}$/.test(code)) return refused("Enter the 6 digits the buyer tells you.", "code");
  const result = answer(await customerApi<ShopOrder>("POST", `/v1/classifieds/orders/${orderId}/release`, { code }));
  if (result.ok) revalidatePath(`/shop/orders/${orderId}`);
  return result;
}

/** The buyer opens a dispute (before release): the payment to the seller stops until BitoCard decides. */
export async function openDispute(orderId: string, reason: ShopDisputeReason, details: string, nonce?: string): Promise<ShopResult<unknown>> {
  if (!id(orderId) || !["not_received", "not_as_described", "damaged", "other"].includes(reason)) return refused("No such order.");
  if (details.trim().length < 10) return refused("Tell us what happened, in a sentence or two.", "details");
  const result = answer(await customerApi("POST", `/v1/classifieds/orders/${orderId}/dispute`, { reason, details: details.trim().slice(0, 2000) }, { idempotencyKey: nonce }));
  if (result.ok) revalidatePath(`/shop/orders/${orderId}`);
  return result;
}

export async function loadDispute(orderId: string): Promise<ShopResult<ShopDispute>> {
  if (!id(orderId)) return refused("No such order.");
  return answer(await customerApi<ShopDispute>("GET", `/v1/classifieds/orders/${orderId}/dispute`));
}

/** A message on the dispute (photos go through `/api/shop/orders/<id>/dispute`). */
export async function disputeMessage(orderId: string, text: string): Promise<ShopResult<ShopDisputeMessage>> {
  if (!id(orderId)) return refused("No such order.");
  if (!text.trim()) return refused("Write a message.");
  const form = new FormData();
  form.set("body", text.trim().slice(0, 2000));
  return answer(await customerApi<ShopDisputeMessage>("POST", `/v1/classifieds/orders/${orderId}/dispute/messages`, form));
}

// ---- Favourites ----

export async function removeFavourite(listingId: string): Promise<ShopResult<unknown>> {
  if (!id(listingId)) return refused("No such listing.");
  const result = answer(await customerApi("DELETE", `/v1/classifieds/favourites/${listingId}`));
  if (result.ok) revalidatePath("/shop/favourites");
  return result;
}
