"use server";

import { customerApi } from "@/lib/customer";
import { cleanSellSource, type SellSource } from "@/lib/sell-sources";

/**
 * Post an ad's steps for the seller's posting journey (Udozo's admin, Reports > Posting journeys): only which step was
 * reached or could not be left and the field it needed, never anything the seller typed. The types are closed, so
 * nothing else can be sent, and a failure never troubles the seller.
 */
const steps = ["basics", "media", "details", "where", "place", "post"] as const;
const params = ["title", "category_id", "photos", "price", "condition", "on_shop", "area_id", "terms"] as const;
type Step = (typeof steps)[number];
type Param = (typeof params)[number];

export type PostingStep =
  | { type: "sell_opened"; source: SellSource }
  | { type: "form_resumed"; listing_id: string }
  | { type: "step_reached"; step: Step; listing_id?: string | null }
  | { type: "step_refused"; step: Step; param: string; listing_id?: string | null }
  | { type: "terms_ticked"; listing_id?: string | null }
  | { type: "post_pressed"; listing_id?: string | null };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Only the keys and values the API accepts: anything else is dropped here first. */
export async function cleanPostingStep(step: PostingStep): Promise<Record<string, string> | null> {
  const listing: Record<string, string> = "listing_id" in step && step.listing_id && uuid.test(step.listing_id) ? { listing_id: step.listing_id } : {};
  switch (step.type) {
    case "sell_opened":
      return { type: step.type, source: cleanSellSource(step.source) };
    case "form_resumed":
      return listing.listing_id ? { type: step.type, ...listing } : null;
    case "step_reached":
      return (steps as readonly string[]).includes(step.step) ? { type: step.type, step: step.step, ...listing } : null;
    case "step_refused":
      if (!(steps as readonly string[]).includes(step.step)) return null;
      return { type: step.type, step: step.step, ...((params as readonly string[]).includes(step.param) ? { param: step.param as Param } : {}), ...listing };
    case "terms_ticked":
    case "post_pressed":
      return { type: step.type, ...listing };
    default:
      return null;
  }
}

/** One step of Post an ad, told to Udozo (signed-in sellers only: the API refuses anyone else). */
export async function recordPostingStep(step: PostingStep): Promise<void> {
  const body = await cleanPostingStep(step);
  if (!body) return;
  await customerApi("POST", "/v1/classifieds/posting-journeys/events", body).catch(() => undefined);
}

/** Post an ad (or sign-in on the way to it) was opened: counted for the day by where Sell was pressed, nothing else kept. */
export async function countSellVisit(source: SellSource, signedIn: boolean): Promise<void> {
  await customerApi("POST", "/v1/posting-journeys/visits", { source: cleanSellSource(source), signed_in: signedIn }).catch(() => undefined);
}
