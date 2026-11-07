import type { ShopListingCard, ShopPrice } from "@bitocard/api-client/classifieds";

/** A wanted request as the API presents it (`classified_wanted_request`). */
export type WantedRequest = {
  object: "classified_wanted_request";
  id: string;
  number: string;
  words: string;
  details: string | null;
  country: string;
  category: { id: string; slug: string; name: string };
  place: string | null;
  budget: { min: number | null; max: number | null; currency: string; text: string | null };
  conditions: string[];
  condition_text: string | null;
  status: "open" | "fulfilled" | "closed" | "expired" | "removed";
  source: "web" | "whatsapp";
  mine: boolean;
  buyer: string;
  sellers_told: number;
  responses: number;
  expires_at: string;
  created_at: string;
};

export type WantedCreated = WantedRequest & { matches: ShopListingCard[] };
export type WantedResponseRow = { id: string; seller: string; note: string | null; listing: ShopListingCard | null; conversation_id: string | null; created_at: string };
/** The buyer's own request: its answers and listings that may fit. */
export type WantedMine = Omit<WantedRequest, "responses"> & { matches: ShopListingCard[]; responses: WantedResponseRow[] };
/** A seller's view of a request they were told about: which of their listings can answer it. */
export type WantedForSeller = WantedRequest & { answered: boolean; answer_listing_id: string | null; your_listings: Array<{ id: string; ref: number; title: string | null; slug: string | null; price: ShopPrice }> };
export type WantedForYou = WantedRequest & { answered: boolean; told_at: string };

export const wantedScreen = "/account/wanted";
export const wantedTabs = ["mine", "for-you"] as const;
export type WantedTab = (typeof wantedTabs)[number];

/** What a request's status says. */
export const wantedStatusText: Record<WantedRequest["status"], string> = {
  open: "Open",
  fulfilled: "Found it",
  closed: "Closed",
  expired: "Ended",
  removed: "Removed by Udozo",
};

/** "Ends in 3 days", "Ends today", or how it ended. */
export function wantedWhen(request: Pick<WantedRequest, "status" | "expires_at">, now = Date.now()) {
  if (request.status !== "open") return wantedStatusText[request.status];
  const days = Math.ceil((new Date(request.expires_at).getTime() - now) / 86_400_000);
  return days <= 0 ? "Ends today" : days === 1 ? "Ends tomorrow" : `Ends in ${days} days`;
}

/** The conditions a buyer chooses on the form, as the API stores them. */
export const wantedConditionChoices = [
  { value: "any", label: "New or used", conditions: [] as string[] },
  { value: "new", label: "New only", conditions: ["new"] },
  { value: "used", label: "Used is fine", conditions: ["used", "untested"] },
] as const;

export const conditionsFor = (choice: string) => [...(wantedConditionChoices.find(item => item.value === choice)?.conditions ?? [])];

/** What a refusal says, in plain words. */
export function wantedErrorText(error: { status: number; code: string | null; message: string }) {
  if (error.status === 401) return "Sign in again to carry on.";
  switch (error.code) {
    case "wanted_unavailable":
      return "Requests are not open in your country yet.";
    case "too_many_requests":
      return "You have the most open requests you can have. Close one first.";
    case "request_limit":
      return "You have made several requests today. Try again tomorrow.";
    case "request_prohibited":
      return "This cannot be asked for on Udozo.";
    case "already_answered":
      return "You already answered this request.";
    case "request_closed":
      return "This request is closed.";
    default:
      return error.message || "That did not work. Try again in a moment.";
  }
}
