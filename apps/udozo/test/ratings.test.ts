import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ShopInteractionSummary } from "@bitocard/api-client/classifieds";
import { setRequest } from "./request";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/account/ratings" }));

const { asOfText, scoreWord, summaryLines, summaryWaiting } = await import("@/lib/ratings");
const actions = await import("@/lib/rating-actions");
const { RatingForm } = await import("@/components/ratings/rate-seller");
const { accountPlaces, currentPlace } = await import("@/lib/account-places");

type Call = [string, RequestInit & { headers: Record<string, string> }];
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const listing = "6f7a8b9c-0d1e-4f2a-8b3c-4d5e6f7a8b9c";

beforeEach(() => {
  vi.stubEnv("API_URL", "http://api.test");
  setRequest({ host: "udozo.com" }, { udz_customer: "bcc_session" });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const summary = (overrides: Partial<ShopInteractionSummary> = {}): ShopInteractionSummary => ({
  object: "classified_interaction_summary",
  open: true,
  as_of: "2026-11-05T00:00:00.000Z",
  minimum: 5,
  shown: true,
  count: 6,
  scores: { responsiveness: 4.2, helpfulness: 3, courtesy: null },
  tags: [
    { tag: "answered_fast", count: 4 },
    { tag: "pushy", count: 1 },
  ],
  ...overrides,
});

describe("ratings' words", () => {
  test("scores in words, the summary's lines, and why it is not shown yet", () => {
    expect([scoreWord(1), scoreWord(4.2), scoreWord(4.6), scoreWord(9)]).toEqual(["Poor", "Very good", "Excellent", "Excellent"]);
    const lines = summaryLines(summary())!;
    expect(lines.scores.map(line => line.text)).toEqual(["4.2 of 5 · Very good", "3.0 of 5 · Good", "No ratings"]);
    expect(lines.tags.map(tag => `${tag.label}: ${tag.text}`)).toEqual(["Answered fast: 4 buyers", "Pushy: 1 buyer"]);
    expect(summaryLines(summary({ shown: false, scores: null }))).toBeNull();
    expect(summaryWaiting(summary({ shown: false }))).toMatch(/once 5 buyers have rated you/);
    expect(summaryWaiting(summary({ open: false }))).toMatch(/do not rate sellers in your market/);
    expect(summaryWaiting(summary())).toBeNull();
    expect(asOfText("2026-11-05T00:00:00.000Z")).toBe("Counted up to 4 November 2026");
  });

  test("the ratings page is under Reviews in the account's places", () => {
    expect(currentPlace(accountPlaces({ unread: 0, resellers: { count: 0, waiting: 0 } }), "/account/ratings")).toBe("/account/reviews");
  });
});

describe("rating actions", () => {
  test("asking the state passes prompt; rating sends the scores, known tags and a trimmed note with the nonce", async () => {
    const fetch = vi.fn(async () => reply({}));
    vi.stubGlobal("fetch", fetch);
    await actions.ratingState(listing, true);
    await actions.rateSeller(listing, { responsiveness: 4, helpfulness: 5, courtesy: 3, tags: ["answered_fast", "lovely" as "rude", "answered_fast"], comment: "  Fine  " }, "rate-nonce-1");
    await actions.notNow(listing);
    const calls = fetch.mock.calls as unknown as Call[];
    expect(calls.map(([url, init]) => `${init.method} ${url}`)).toEqual([
      `GET http://api.test/v1/classifieds/interaction-ratings/state?listing_id=${listing}&prompt=true`,
      "POST http://api.test/v1/classifieds/interaction-ratings",
      "POST http://api.test/v1/classifieds/interaction-ratings/prompt/dismiss",
    ]);
    expect(JSON.parse(String(calls[1]![1].body))).toEqual({ listing_id: listing, responsiveness: 4, helpfulness: 5, courtesy: 3, tags: ["answered_fast"], comment: "Fine" });
    expect(calls[1]![1].headers["idempotency-key"]).toBe("rate-nonce-1");
  });

  test("bad input never leaves; the API's refusal is shown", async () => {
    const fetch = vi.fn(async () => reply({ error: { type: "conflict_error", code: "seller_rated_recently", message: "You rated this seller in the last 30 days." } }, 409));
    vi.stubGlobal("fetch", fetch);
    expect((await actions.rateSeller("nope", { responsiveness: 4, helpfulness: 4, courtesy: 4 })).ok).toBe(false);
    expect((await actions.rateSeller(listing, { responsiveness: 0, helpfulness: 4, courtesy: 4 })).ok).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    expect(await actions.rateSeller(listing, { responsiveness: 4, helpfulness: 4, courtesy: 6 > 5 ? 5 : 1 })).toMatchObject({ ok: false, code: "seller_rated_recently" });
  });
});

describe("the rating form", () => {
  test("three scores as stars, tags in groups with safety apart, and the privacy promises", () => {
    const html = renderToStaticMarkup(createElement(RatingForm, { listingId: listing, seller: "Chinedu O.", onDone: () => undefined }));
    expect(html).toContain("How did Chinedu O. deal with you?");
    for (const label of ["Replies", "Helpfulness", "Courtesy", "What went well", "What did not", "Safety", "Asked me to pay outside Udozo"]) expect(html).toContain(label);
    expect(html.match(/type="radio"/g)?.length).toBe(15);
    expect(html).toContain("For Udozo&#x27;s team only. The seller never sees it.");
    expect(html).toContain("never sees who rated them");
    expect(html).toContain("Send rating");
  });
});
