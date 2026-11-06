import { humanise } from "@bitocard/admin-ui";
import { listingReviewCodeLabels, type ListingReviewCode, type PostingMilestone, type PostingStatus, type PostingStuckMilestone } from "@bitocard/api-client/admin";

/** Reports > Posting journeys: what each step, milestone, source and refusal means, in words. */
export const milestoneLabels: Record<PostingMilestone, string> = {
  opened: "Opened Post an ad",
  draft: "Draft saved",
  step_media: "Reached photos",
  step_details: "Reached price and details",
  step_where: "Reached where to sell",
  step_place: "Reached location",
  step_post: "Reached terms and post",
  submitted: "Posted",
  live: "Live",
  first_view: "First view",
  first_contact: "First chat or call",
  first_lead: "First lead",
  sold: "Sold",
};

/** Where an unfinished journey is: the milestone it has not reached yet. */
export const stuckLabels: Record<PostingStuckMilestone, string> = {
  opened: "Never opened Post an ad",
  draft: "Opened Post an ad, nothing saved",
  step_media: "Stopped at title and category",
  step_details: "Stopped at photos",
  step_where: "Stopped at price and details",
  step_place: "Stopped at where to sell",
  step_post: "Stopped at location and delivery",
  submitted: "Did not press Post",
  resubmitted: "Sent back, not posted again",
};

export const statusLabels: Record<PostingStatus, string> = {
  in_progress: "In progress",
  stuck: "Stuck",
  in_review: "In review",
  sent_back: "Sent back",
  live: "Live",
  sold: "Sold",
  abandoned: "Abandoned",
  removed: "Removed",
};
export const statusTones: Record<PostingStatus, "blue" | "amber" | "green" | "red" | "grey" | "pink"> = {
  in_progress: "blue",
  stuck: "amber",
  in_review: "pink",
  sent_back: "amber",
  live: "green",
  sold: "green",
  abandoned: "grey",
  removed: "red",
};

const sourceLabels: Record<string, string> = {
  header: "Header Sell",
  header_phone: "Phone Sell button",
  my_listings: "My listings",
  empty_state: "My listings (no ads yet)",
  start_here: "Start here",
  invite: "Invite link",
  pwa: "App shortcut",
  reseller: "Resell page",
  username: "Username page",
  direct: "Typed or linked",
  api: "Draft made without Sell",
  resumed: "Draft from before",
  unknown: "Unknown",
};
export const sourceLabel = (source: string | null | undefined) => (source ? (sourceLabels[source] ?? humanise(source)) : "—");

const stepLabels: Record<string, string> = {
  sell_opened: "Opened Post an ad",
  form_resumed: "Opened the draft again",
  step_basics: "Title and category",
  step_media: "Photos and video",
  step_details: "Price and details",
  step_where: "Where to sell",
  step_place: "Location and delivery",
  step_post: "Terms and post",
  terms_ticked: "Ticked the terms",
  post_pressed: "Pressed Post",
  create: "Saved the draft",
  photo: "Added the first photo",
  video: "Added a video",
  submit: "Posted the ad",
  resubmit: "Posted it again",
  review_queued: "Sent to a moderator",
  review_requeued: "Back to a moderator",
  approved: "Approved: live",
  sent_back: "Sent back to the seller",
  removed: "Removed by a moderator",
  went_live: "Went live",
  first_view: "First view",
  reminder_unfinished: "Reminded to finish it",
  reminder_ready_1: "Reminded to post it (1 of 3)",
  reminder_ready_2: "Reminded to post it (2 of 3)",
  reminder_ready_3: "Reminded to post it (3 of 3)",
  sold: "Marked sold",
  delete: "Deleted",
};
export const stepLabel = (step: string | null | undefined) => (step ? (stepLabels[step] ?? humanise(step)) : "—");

const originLabels: Record<string, string> = { api: "Posting", client: "Form", system: "Udozo" };
export const originLabel = (origin: string) => originLabels[origin] ?? humanise(origin);

const codeLabels: Record<string, string> = {
  step_incomplete: "The form asked for more",
  photos_required: "Too few photos",
  media_failed: "A photo could not be used",
  listing_incomplete: "Something still missing",
  listing_prohibited: "Mentions a prohibited item",
  listing_limit_reached: "Monthly ads limit reached",
  terms_not_accepted: "Terms not accepted",
  email_not_verified: "Email not confirmed",
  supplier_not_ready: "Not ready to sell to resellers",
  listing_not_draft: "Already posted",
  classifieds_suspended: "Seller suspended",
  classifieds_unavailable: "Udozo closed in the country",
  country_required: "No country on the account",
  parameter_invalid: "A field was not accepted",
  parameter_missing: "A field was left empty",
  upload_invalid: "The file was not accepted",
  rate_limited: "Too many attempts",
  api_error: "Something went wrong at Udozo",
  // Why ads were sent to a moderator.
  first_listings: "A new seller's first ads",
  prohibited_words: "Words to check",
  price_low: "Price far below usual",
  photo_reused: "Photo used by another seller",
  posting_fast: "Posting very fast",
  reported: "Reported by buyers",
  edited: "Edited while live",
};
export const codeLabel = (code: string | null | undefined) => {
  if (!code) return "—";
  if (code in listingReviewCodeLabels) return listingReviewCodeLabels[code as ListingReviewCode];
  return codeLabels[code] ?? humanise(code);
};

const paramLabels: Record<string, string> = { title: "title", category_id: "category", photos: "photos", price: "price", condition: "condition", on_shop: "where to sell", area_id: "area", terms: "the terms box" };
export const paramLabel = (param: string | null | undefined) => (param ? (paramLabels[param] ?? param.replace(/_/g, " ")) : null);

export const reviewCodeLabel = (code: string | null | undefined) => (code ? (listingReviewCodeLabels[code as ListingReviewCode] ?? humanise(code)) : "—");

export const percent = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 1000) / 10}%` : "—");

/** "4 min", "2 h 5 min", "3 days" (from minutes). */
export function minutesText(minutes: number | null) {
  if (minutes === null) return "—";
  const rounded = Math.round(minutes);
  if (rounded < 1) return "under a minute";
  if (rounded < 60) return `${rounded} min`;
  const hours = Math.floor(rounded / 60);
  if (hours < 48) return `${hours} h${rounded % 60 ? ` ${rounded % 60} min` : ""}`;
  return `${Math.round(hours / 24)} days`;
}
