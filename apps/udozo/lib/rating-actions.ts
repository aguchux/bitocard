"use server";

import { interactionBadTags, interactionGoodTags, interactionSafetyTags, type ShopInteractionRating, type ShopInteractionScores, type ShopInteractionState, type ShopInteractionSummary, type ShopInteractionTag } from "@bitocard/api-client/classifieds";
import { customerApi } from "@/lib/customer";
import type { ActionResult } from "@/lib/listing-actions";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const tags: readonly string[] = [...interactionGoodTags, ...interactionBadTags, ...interactionSafetyTags];
const refused = (message: string): ActionResult<never> => ({ ok: false, message, code: "parameter_invalid", signIn: false });

function answer<T>(result: Awaited<ReturnType<typeof customerApi<T>>>): ActionResult<T> {
  if (result.ok) return { ok: true, data: result.data };
  return { ok: false, message: result.status === 401 ? "Sign in again to carry on." : result.message, code: result.code, signIn: result.status === 401 };
}

export type RatingForm = ShopInteractionScores & { tags?: ShopInteractionTag[]; comment?: string };

const scoreOk = (value: unknown) => Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 5;
function cleanForm(input: RatingForm) {
  if (![input.responsiveness, input.helpfulness, input.courtesy].every(scoreOk)) return null;
  return {
    responsiveness: input.responsiveness,
    helpfulness: input.helpfulness,
    courtesy: input.courtesy,
    tags: [...new Set(input.tags ?? [])].filter(tag => tags.includes(tag)),
    comment: input.comment?.trim() ? input.comment.trim().slice(0, 500) : undefined,
  };
}

/** Whether the buyer can rate the seller about a listing; with `prompt`, whether to ask them now (counts as asking). */
export async function ratingState(listingId: string, prompt = false): Promise<ActionResult<ShopInteractionState>> {
  if (!uuid.test(listingId)) return refused("No such listing.");
  return answer(await customerApi<ShopInteractionState>("GET", `/v1/classifieds/interaction-ratings/state?listing_id=${listingId}${prompt ? "&prompt=true" : ""}`));
}

/** Rates the seller about a listing; the form's nonce makes a double tap send one. */
export async function rateSeller(listingId: string, input: RatingForm, nonce?: string): Promise<ActionResult<ShopInteractionRating>> {
  if (!uuid.test(listingId)) return refused("No such listing.");
  const body = cleanForm(input);
  if (!body) return refused("Give each a score from 1 to 5.");
  return answer(await customerApi<ShopInteractionRating>("POST", "/v1/classifieds/interaction-ratings", { listing_id: listingId, ...body }, { idempotencyKey: nonce }));
}

export async function changeRating(id: string, input: RatingForm): Promise<ActionResult<ShopInteractionRating>> {
  if (!uuid.test(id)) return refused("No such rating.");
  const body = cleanForm(input);
  if (!body) return refused("Give each a score from 1 to 5.");
  return answer(await customerApi<ShopInteractionRating>("PATCH", `/v1/classifieds/interaction-ratings/${id}`, { ...body, comment: body.comment ?? null }));
}

/** Not now: they are not asked about this listing again. */
export async function notNow(listingId: string): Promise<ActionResult<unknown>> {
  if (!uuid.test(listingId)) return refused("No such listing.");
  return answer(await customerApi<unknown>("POST", "/v1/classifieds/interaction-ratings/prompt/dismiss", { listing_id: listingId }));
}

export async function mySummary(): Promise<ActionResult<ShopInteractionSummary>> {
  return answer(await customerApi<ShopInteractionSummary>("GET", "/v1/classifieds/me/ratings"));
}

/** The seller says Anjio's summary of them is wrong: Udozo's team reads it. */
export async function reportSummary(details: string): Promise<ActionResult<unknown>> {
  const text = details.trim().slice(0, 500);
  if (text.length < 3) return refused("Say what is wrong.");
  return answer(await customerApi<unknown>("POST", "/v1/classifieds/me/scores/summary/report", { details: text }));
}
