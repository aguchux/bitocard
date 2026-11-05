"use server";

import type { ShopPurchase, ShopReview, ShopReviewPost, ShopReviewRating, ShopReviewReportReason, ShopReviewStance, ShopReviewViewer } from "@bitocard/api-client/classifieds";
import { customerApi } from "@/lib/customer";
import type { ActionResult } from "@/lib/listing-actions";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ratings: ShopReviewRating[] = ["positive", "neutral", "negative"];
const stances: ShopReviewStance[] = ["agree", "disagree", "context"];
const reasons: ShopReviewReportReason[] = ["fake", "not_a_buyer", "offensive", "personal_info", "contact_or_links", "threat_or_extortion", "off_topic", "other"];
const parts = ["described", "communication", "handover"];
const refused = (message: string): ActionResult<never> => ({ ok: false, message, code: "parameter_invalid", signIn: false });

function answer<T>(result: Awaited<ReturnType<typeof customerApi<T>>>): ActionResult<T> {
  if (result.ok) return { ok: true, data: result.data };
  return { ok: false, message: result.status === 401 ? "Sign in again to carry on." : result.message, code: result.code, signIn: result.status === 401 };
}

const clean = (text: string | undefined, max: number) => (text?.trim() ? text.trim().slice(0, max) : undefined);
const cleanAspects = (aspects: Record<string, "up" | "down"> | undefined) => Object.fromEntries(Object.entries(aspects ?? {}).filter(([key, value]) => parts.includes(key) && (value === "up" || value === "down")));

export type ReviewForm = { rating: ShopReviewRating; aspects?: Record<string, "up" | "down">; body?: string };

/** Writes the buyer's review of a purchase; the form's nonce makes a double tap send one. */
export async function writeReview(purchaseId: string, input: ReviewForm, nonce?: string): Promise<ActionResult<ShopReview>> {
  if (!uuid.test(purchaseId)) return refused("No such purchase.");
  if (!ratings.includes(input.rating)) return refused("Choose a rating.");
  return answer(await customerApi<ShopReview>("POST", `/v1/classifieds/purchases/${purchaseId}/review`, { rating: input.rating, aspects: cleanAspects(input.aspects), body: clean(input.body, 1000) }, { idempotencyKey: nonce }));
}

export async function editReview(id: string, input: ReviewForm): Promise<ActionResult<ShopReview>> {
  if (!uuid.test(id)) return refused("No such review.");
  if (!ratings.includes(input.rating)) return refused("Choose a rating.");
  return answer(await customerApi<ShopReview>("PATCH", `/v1/classifieds/reviews/${id}`, { rating: input.rating, aspects: cleanAspects(input.aspects), body: input.body?.trim() ?? "" }));
}

export async function withdrawReview(id: string): Promise<ActionResult<ShopReview>> {
  if (!uuid.test(id)) return refused("No such review.");
  return answer(await customerApi<ShopReview>("DELETE", `/v1/classifieds/reviews/${id}`));
}

export async function dismissPurchase(id: string): Promise<ActionResult<ShopPurchase>> {
  if (!uuid.test(id)) return refused("No such purchase.");
  return answer(await customerApi<ShopPurchase>("POST", `/v1/classifieds/purchases/${id}/dismiss`, {}));
}

export async function reviewViewer(id: string): Promise<ActionResult<ShopReviewViewer>> {
  if (!uuid.test(id)) return refused("No such review.");
  return answer(await customerApi<ShopReviewViewer>("GET", `/v1/classifieds/reviews/${id}/viewer`));
}

/** A reply in a review's conversation (a buyer of the same item says where they stand). */
export async function postReply(reviewId: string, input: { body: string; stance?: ShopReviewStance; reply_to?: string }, nonce?: string): Promise<ActionResult<ShopReviewPost>> {
  if (!uuid.test(reviewId) || (input.reply_to && !uuid.test(input.reply_to))) return refused("No such review.");
  if (input.stance && !stances.includes(input.stance)) return refused("Say whether you agree, disagree or are adding context.");
  const body = clean(input.body, 600);
  if (!body) return refused("Write something.");
  return answer(await customerApi<ShopReviewPost>("POST", `/v1/classifieds/reviews/${reviewId}/posts`, { body, ...(input.stance ? { stance: input.stance } : {}), ...(input.reply_to ? { reply_to: input.reply_to } : {}) }, { idempotencyKey: nonce }));
}

/** Changes one's own reply (within 15 minutes of writing it). */
export async function editReply(postId: string, body: string): Promise<ActionResult<ShopReviewPost>> {
  if (!uuid.test(postId)) return refused("No such reply.");
  const text = clean(body, 600);
  if (!text) return refused("Write something.");
  return answer(await customerApi<ShopReviewPost>("PATCH", `/v1/classifieds/review-posts/${postId}`, { body: text }));
}

export async function deleteReply(postId: string): Promise<ActionResult<unknown>> {
  if (!uuid.test(postId)) return refused("No such reply.");
  return answer(await customerApi("DELETE", `/v1/classifieds/review-posts/${postId}`));
}

export async function reportReview(reviewId: string, input: { reason: ShopReviewReportReason; details?: string; post_id?: string }): Promise<ActionResult<unknown>> {
  if (!uuid.test(reviewId) || (input.post_id && !uuid.test(input.post_id))) return refused("No such review.");
  if (!reasons.includes(input.reason)) return refused("Choose what is wrong.");
  return answer(await customerApi("POST", `/v1/classifieds/reviews/${reviewId}/report`, { reason: input.reason, ...(clean(input.details, 500) ? { details: clean(input.details, 500) } : {}), ...(input.post_id ? { post_id: input.post_id } : {}) }));
}
