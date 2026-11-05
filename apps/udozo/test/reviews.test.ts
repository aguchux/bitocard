import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ShopReview, ShopReviewViewer } from "@bitocard/api-client/classifieds";
import { setRequest } from "./request";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/account/reviews" }));

const { canEditPost, monthText, negativeProblem, readReviewFilters, reviewsHref, reviewSellerBase, sellerReviewsQuery, summaryText } = await import("@/lib/reviews");
const { buyQuestion } = await import("@/lib/buy-orders");
const buyActions = await import("@/lib/buy-order-actions");
const { waitingForReply } = await import("@/lib/scores");
const { chatReportReasonLabels } = await import("@bitocard/api-client/classifieds");
const actions = await import("@/lib/review-actions");
const { ReviewCard, ReviewSummaryBar } = await import("@/components/reviews/review-view");
const { ReviewForm, ReviewThread } = await import("@/components/reviews/review-forms");

type Call = [string, RequestInit & { headers: Record<string, string> }];
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const purchase = "0b7c2a1e-4d5f-4a6b-8c9d-0e1f2a3b4c5d";
const id = "6f7a8b9c-0d1e-4f2a-8b3c-4d5e6f7a8b9c";

const review: ShopReview = {
  object: "classified_review",
  id,
  rating: "negative",
  aspects: { described: "down", handover: "up" },
  body: "The battery was weaker than described.",
  reviewer: { name: "Kemi A.", avatar_url: null },
  seller: { name: "Chinedu O.", handle: "a2379d4498", username: "chinedu", country: "NG" },
  product: { key: "bm:apple:iphone13", label: "Apple iPhone 13" },
  source: "buy_order",
  month: "2026-11",
  edited: true,
  edited_after_reply: true,
  locked: false,
  post_count: 3,
  posts: [
    { id: "11111111-1111-4111-8111-111111111111", role: "seller", name: "Chinedu O.", avatar_url: null, stance: null, reply_to: null, body: "Sorry, happy to check it.", removed: false, edited: false, created_at: "2026-11-05T10:00:00Z" },
    { id: "22222222-2222-4222-8222-222222222222", role: "buyer", name: "Tunde B.", avatar_url: null, stance: "disagree", reply_to: null, body: null, removed: true, edited: false, created_at: "2026-11-05T11:00:00Z" },
  ],
  created_at: "2026-11-05T09:00:00Z",
};

beforeEach(() => {
  vi.stubEnv("API_URL", "http://api.test");
  setRequest({ host: "udozo.com" }, { udz_customer: "bcc_session" });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("reviews' words and addresses", () => {
  test("the summary shows the share only once the API gives one; nothing with no reviews", () => {
    expect(summaryText({ positive: 118, neutral: 2, negative: 2, counted: 120, positive_pct: 98 })).toBe("98% positive · 122 reviews");
    expect(summaryText({ positive: 1, neutral: 0, negative: 0, counted: 1, positive_pct: null })).toBe("1 review");
    expect(summaryText({ positive: 0, neutral: 0, negative: 0, counted: 0, positive_pct: null })).toBeNull();
    expect(summaryText(null)).toBeNull();
    expect(monthText("2026-03")).toBe("March 2026");
  });

  test("a negative review needs a reason or a part marked down", () => {
    expect(negativeProblem("negative", "Bad", {})).toMatch(/Say what went wrong/);
    expect(negativeProblem("negative", "Bad", { described: "down" })).toBeNull();
    expect(negativeProblem("negative", "It stopped working the next day.", {})).toBeNull();
    expect(negativeProblem("positive", "", {})).toBeNull();
  });

  test("the seller page's review filters are read safely and written back to the Reviews section", () => {
    expect(readReviewFilters({ rv_product: "bm:apple:iphone13", rv_sort: "negative", rv_page: "2" })).toEqual({ product: "bm:apple:iphone13", sort: "negative", page: 2 });
    expect(readReviewFilters({ rv_product: "<script>", rv_page: "-1" })).toEqual({ product: null, sort: "newest", page: 1 });
    const filters = { product: "bm:apple:iphone13", sort: "negative" as const, page: 3 };
    expect(reviewsHref("/ng/seller/chinedu", filters, { sort: "newest" })).toBe("/ng/seller/chinedu?rv_product=bm%3Aapple%3Aiphone13#reviews");
    expect(reviewsHref("/ng/seller/chinedu", filters, { page: 4 })).toBe("/ng/seller/chinedu?rv_product=bm%3Aapple%3Aiphone13&rv_sort=negative&rv_page=4#reviews");
    expect(sellerReviewsQuery("chinedu", filters)).toBe("/v1/classifieds/sellers/chinedu/reviews?limit=10&offset=20&sort=negative&product=bm%3Aapple%3Aiphone13");
    expect(reviewSellerBase(review)).toBe("/ng/seller/chinedu");
  });

  test("no review markup for search engines: reviews are of the seller, not a product", () => {
    for (const file of ["lib/seo.ts", "app/[cc]/seller/[handle]/page.tsx", "app/[cc]/l/[listing]/page.tsx"]) {
      expect(readFileSync(join(__dirname, "..", file), "utf8")).not.toMatch(/aggregateRating|"@type":\s*"Review"/);
    }
  });
});

describe("review actions", () => {
  test("writing sends the rating, the parts and the words with the nonce; bad input never leaves", async () => {
    const fetch = vi.fn(async () => reply(review, 201));
    vi.stubGlobal("fetch", fetch);
    expect((await actions.writeReview(purchase, { rating: "positive", aspects: { described: "up", nonsense: "up" } as Record<string, "up">, body: "  Great  " }, "review-nonce-1")).ok).toBe(true);
    const [url, init] = fetch.mock.calls[0] as unknown as Call;
    expect(url).toBe(`http://api.test/v1/classifieds/purchases/${purchase}/review`);
    expect(JSON.parse(String(init.body))).toEqual({ rating: "positive", aspects: { described: "up" }, body: "Great" });
    expect(init.headers["idempotency-key"]).toBe("review-nonce-1");
    expect((await actions.writeReview("nope", { rating: "positive" })).ok).toBe(false);
    expect((await actions.writeReview(purchase, { rating: "great" as "positive" })).ok).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("replies, reports and withdrawals go to their addresses; the API's refusal is shown", async () => {
    const fetch = vi.fn(async () => reply({}));
    vi.stubGlobal("fetch", fetch);
    await actions.postReply(id, { body: " Mine was fine ", stance: "disagree" }, "reply-nonce-1");
    await actions.reportReview(id, { reason: "threat_or_extortion", details: "Asked for a refund" });
    await actions.withdrawReview(id);
    const calls = fetch.mock.calls as unknown as Call[];
    expect(calls.map(([url, init]) => `${init.method} ${url}`)).toEqual([`POST http://api.test/v1/classifieds/reviews/${id}/posts`, `POST http://api.test/v1/classifieds/reviews/${id}/report`, `DELETE http://api.test/v1/classifieds/reviews/${id}`]);
    expect(JSON.parse(String(calls[0]![1].body))).toEqual({ body: "Mine was fine", stance: "disagree" });
    expect((await actions.postReply(id, { body: "   " })).ok).toBe(false);
    expect((await actions.reportReview(id, { reason: "rude" as "fake" })).ok).toBe(false);
    vi.stubGlobal("fetch", vi.fn(async () => reply({ error: { type: "permission_error", code: "thread_not_allowed", message: "Only buyers of the same item can write here." } }, 403)));
    expect(await actions.postReply(id, { body: "Hi" })).toMatchObject({ ok: false, code: "thread_not_allowed" });
  });
});

describe("review screens", () => {
  test("a review shows its rating, parts, words, who and when, and its conversation folded with a link on", () => {
    const html = renderToStaticMarkup(createElement(ReviewCard, { review, href: "/ng/seller/chinedu/reviews/x" }));
    expect(html).toContain("Negative");
    expect(html).toContain("As described");
    expect(html).toContain("Kemi A.");
    expect(html).toContain("November 2026 · Buy order");
    expect(html).toContain("Edited after the seller replied");
    expect(html).toContain("Removed by Udozo");
    expect(html).toContain("Disagrees");
    expect(html).toContain("Read the conversation (1 more)");
    expect(renderToStaticMarkup(createElement(ReviewSummaryBar, { summary: { positive: 3, neutral: 0, negative: 1, counted: 4, positive_pct: 75 } }))).toContain("75% positive · 4 reviews");
  });

  test("the form offers Neutral only where the market does", () => {
    const off = renderToStaticMarkup(createElement(ReviewForm, { purchaseId: purchase, seller: "Chinedu O.", neutral: false }));
    expect(off).toContain(">Positive</button>");
    expect(off).not.toContain(">Neutral</button>");
    expect(off).toContain("Post review");
    expect(renderToStaticMarkup(createElement(ReviewForm, { purchaseId: purchase, seller: "Chinedu O.", neutral: true, dismissible: true }))).toMatch(/>Neutral<\/button>[\s\S]*Not now/);
  });

  test("the reply form shows only where the reader may write, with a stance for buyers of the same item", () => {
    const viewer = (role: ShopReviewViewer["role"], can: boolean): ShopReviewViewer => ({ object: "classified_review_viewer", role, can_post: can, posts_left: can ? 3 : 0, reason: can ? null : "Only buyers of the same item can write here.", can_report: true, own_review: false, can_edit: false });
    const buyer = renderToStaticMarkup(createElement(ReviewThread, { review, viewer: viewer("buyer", true) }));
    expect(buyer).toContain("You bought this item from this seller too");
    expect(buyer).toContain("I disagree");
    expect(buyer).toContain("Send reply");
    const outsider = renderToStaticMarkup(createElement(ReviewThread, { review, viewer: viewer(null, false) }));
    expect(outsider).not.toContain("Send reply");
    expect(outsider).toContain("Only buyers of the same item can write here.");
    expect(outsider).toContain("Report this review");
    expect(renderToStaticMarkup(createElement(ReviewThread, { review, viewer: null }))).not.toContain("Report");
  });
});

describe("the gaps filled", () => {
  test("own replies can be edited for 15 minutes; the edit goes to the reply's address", async () => {
    const now = Date.parse("2026-11-05T12:00:00Z");
    expect(canEditPost({ mine: true, removed: false, created_at: "2026-11-05T11:50:00Z" }, now)).toBe(true);
    expect(canEditPost({ mine: true, removed: false, created_at: "2026-11-05T11:40:00Z" }, now)).toBe(false);
    expect(canEditPost({ mine: false, removed: false, created_at: "2026-11-05T11:59:00Z" }, now)).toBe(false);
    const fetch = vi.fn(async () => reply({}));
    vi.stubGlobal("fetch", fetch);
    expect((await actions.editReply("11111111-1111-4111-8111-111111111111", "   ")).ok).toBe(false);
    await actions.editReply("11111111-1111-4111-8111-111111111111", " Changed my mind ");
    const [url, init] = fetch.mock.calls[0] as unknown as Call;
    expect(`${init.method} ${url}`).toBe("PATCH http://api.test/v1/classifieds/review-posts/11111111-1111-4111-8111-111111111111");
    expect(JSON.parse(String(init.body))).toEqual({ body: "Changed my mind" });
  });

  test("To confirm: Yes, I bought it is a buy order step with its own question", async () => {
    const question = buyQuestion("confirm", { price: 25000000, counter: null, currency: "NGN", with: { name: "Chinedu O." }, listing: { title: "Hisense TV" } } as never);
    expect([question.title, question.action]).toEqual(["You bought Hisense TV?", "Yes, I bought it"]);
    const fetch = vi.fn(async () => reply({}));
    vi.stubGlobal("fetch", fetch);
    await buyActions.buyOrderStep(id, "confirm");
    expect((fetch.mock.calls[0] as unknown as Call)[0]).toBe(`http://api.test/v1/classifieds/buy-orders/${id}/confirm`);
  });

  test("chats can be reported for pressure over a review; reviews waiting for the seller's reply", () => {
    expect(chatReportReasonLabels.review_pressure).toMatch(/Pressure over a review/);
    expect(readFileSync(join(__dirname, "..", "components/account/chat-thread.tsx"), "utf8")).toContain("chatReportReasonLabels");
    const answered = { ...review, id: "a", status: "published", posts: [{ ...review.posts[0]!, role: "seller" as const }] };
    const waiting = { ...review, id: "b", status: "published", posts: [] };
    const locked = { ...review, id: "c", status: "published", locked: true, posts: [] };
    expect(waitingForReply([answered, waiting, locked] as never).map(item => item.id)).toEqual(["b"]);
  });
});
