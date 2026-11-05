import type { ShopReview, ShopReviewRating, ShopReviewSummary } from "@bitocard/api-client/classifieds";
import type { ConfirmOptions } from "@/components/confirm-dialog";

/**
 * Reviews on udozo.com (docs/UDOZO_RATINGS_PLAN.md phase 1), kept apart from React so they are tested: the summary's
 * words, the month a review is from, colours, the seller page's review filters and the questions asked before a step.
 */

export const reviewPageSize = 10;
export const negativeMinChars = 20;
export const maxReviewBody = 1000;
export const maxPostBody = 600;
/** One's own reply can be changed this long after it was written (the API's rule too). */
export const postEditMs = 15 * 60_000;
export const canEditPost = (post: { mine?: boolean; removed: boolean; created_at: string }, now = Date.now()) => Boolean(post.mine) && !post.removed && now - Date.parse(post.created_at) < postEditMs;

/** "98% positive · 120 reviews", or "3 reviews" before the share shows; null with none. */
export function summaryText(summary: ShopReviewSummary | null | undefined) {
  if (!summary) return null;
  const total = summary.positive + summary.neutral + summary.negative;
  if (!total) return null;
  const count = `${total} review${total === 1 ? "" : "s"}`;
  return summary.positive_pct === null ? count : `${summary.positive_pct}% positive · ${count}`;
}

/** "March 2026" from `2026-03`. */
export function monthText(month: string) {
  const [year, value] = month.split("-").map(Number);
  if (!year || !value) return month;
  return new Date(Date.UTC(year, value - 1, 1)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}

export function ratingTone(rating: ShopReviewRating) {
  return rating === "positive" ? "bg-emerald-50 text-emerald-800" : rating === "negative" ? "bg-red-50 text-red-800" : "bg-slate-100 text-slate-700";
}

/** What a negative review still needs before it can be posted, or null. */
export function negativeProblem(rating: ShopReviewRating, body: string, aspects: Record<string, "up" | "down">) {
  if (rating !== "negative") return null;
  if (body.trim().length >= negativeMinChars || Object.values(aspects).includes("down")) return null;
  return "Say what went wrong: a few words, or mark a part down.";
}

export type ReviewFilters = { product: string | null; sort: "newest" | "negative"; page: number };

/** The seller page's review filters from its address (`rv_product`, `rv_sort`, `rv_page`). */
export function readReviewFilters(query: Record<string, string | string[] | undefined>): ReviewFilters {
  const one = (key: string) => (typeof query[key] === "string" ? (query[key] as string) : null);
  const page = Number(one("rv_page") ?? 1);
  const product = one("rv_product");
  return {
    product: product && /^(bm:[a-z0-9]+:[a-z0-9]+|l:[0-9a-f-]{36})$/.test(product) ? product : null,
    sort: one("rv_sort") === "negative" ? "negative" : "newest",
    page: Number.isInteger(page) && page >= 1 && page <= 500 ? page : 1,
  };
}

/** The public API's path for a seller's reviews with those filters. */
export function sellerReviewsQuery(key: string, filters: ReviewFilters) {
  const params = new URLSearchParams({ limit: String(reviewPageSize), offset: String((filters.page - 1) * reviewPageSize), sort: filters.sort });
  if (filters.product) params.set("product", filters.product);
  return `/v1/classifieds/sellers/${encodeURIComponent(key)}/reviews?${params}`;
}

/** The seller page's address with review filters changed (to the Reviews section). */
export function reviewsHref(base: string, filters: ReviewFilters, change: Partial<ReviewFilters>) {
  const next = { ...filters, ...change, ...(change.product !== undefined || change.sort !== undefined ? { page: change.page ?? 1 } : {}) };
  const params = new URLSearchParams();
  if (next.product) params.set("rv_product", next.product);
  if (next.sort === "negative") params.set("rv_sort", "negative");
  if (next.page > 1) params.set("rv_page", String(next.page));
  const query = params.toString();
  return `${base}${query ? `?${query}` : ""}#reviews`;
}

/** A review's own page under its seller's. */
export const reviewPath = (sellerBase: string, id: string) => `${sellerBase}/reviews/${id}`;

/** The seller's page address for a review (its seller's username, else handle, in their market). */
export function reviewSellerBase(review: Pick<ShopReview, "seller">) {
  const country = (review.seller.country ?? "ng").toLowerCase();
  return `/${country}/seller/${review.seller.username ?? review.seller.handle}`;
}

export function negativeQuestion(seller: string): ConfirmOptions {
  return { title: "Post a negative review?", body: `It shows on ${seller}'s page, and they can reply. Keep to what happened: no threats, contact details or demands.`, action: "Post review", tone: "danger" };
}

export const withdrawQuestion: ConfirmOptions = { title: "Withdraw your review?", body: "It no longer shows or counts, and its conversation goes with it. You cannot write another for this purchase.", action: "Withdraw review", dismiss: "Keep it", tone: "danger" };
export const deletePostQuestion: ConfirmOptions = { title: "Delete your reply?", body: "It is taken out of the conversation.", action: "Delete reply", dismiss: "Keep it", tone: "danger" };
