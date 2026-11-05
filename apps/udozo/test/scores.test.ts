import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ShopMyScores, ShopPublicScores } from "@bitocard/api-client/classifieds";
import { setRequest } from "./request";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/account/ratings" }));

const { AnjioView } = await import("@/components/scores/anjio-view");
const { bandText, myScoreLines, anjioMethod } = await import("@/lib/scores");
const actions = await import("@/lib/rating-actions");
const { default: HelpPage } = await import("@/app/(global)/help/how-anjio-rates-sellers/page");

const shown: ShopPublicScores = {
  new_seller: false,
  response: "Usually replies within an hour",
  attention: "Answers almost every request",
  band: "very_good",
  band_label: "Very good",
  highlights: [{ key: "reliability", words: "Completes sales reliably" }],
  summary: { text: "Usually replies within an hour and answers almost every request.", credit: "Written by Anjio, Udozo's AI assistant, from Udozo's figures. It can be imperfect.", how_it_works: "/help/how-anjio-rates-sellers", written_at: null },
  how_it_works: "/help/how-anjio-rates-sellers",
};

beforeEach(() => {
  vi.stubEnv("API_URL", "http://api.test");
  setRequest({ host: "udozo.com" }, { udz_customer: "bcc_session" });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Anjio's view on a seller's page", () => {
  test("words, the band, strong points and the summary with who wrote it; never a number", () => {
    const html = renderToStaticMarkup(createElement(AnjioView, { scores: shown, name: "Chinedu O." }));
    for (const words of ["Anjio&#x27;s view of Chinedu O.", "Very good seller", "Usually replies within an hour", "Answers almost every request", "Completes sales reliably", "Written by Anjio", "How Anjio rates sellers"]) expect(html).toContain(words);
    expect(html.replace(/<[^>]+>/g, "").replace(/&[^;]+;/g, "")).not.toMatch(/\d/);
    const fresh = renderToStaticMarkup(createElement(AnjioView, { scores: { ...shown, new_seller: true, response: null, attention: null, band: null, band_label: null, highlights: [], summary: null }, name: "Ada" }));
    expect(fresh).toContain("New seller: not enough to rate yet.");
  });

  test("never in metadata or structured data", () => {
    for (const file of ["lib/seo.ts", "app/[cc]/seller/[handle]/page.tsx"]) {
      const source = readFileSync(join(__dirname, "..", file), "utf8");
      expect(source).not.toMatch(/scores\.summary[^\n]*(?:description|openGraph|jsonLd)|aggregateRating/);
    }
    expect(readFileSync(join(__dirname, "..", "lib/seo.ts"), "utf8")).not.toMatch(/\.scores\b/);
  });
});

describe("the seller's own scores", () => {
  const mine: ShopMyScores = {
    object: "classified_seller_scores",
    public: false,
    computed_at: "2026-11-05T02:00:00.000Z",
    overall: 78,
    band: "very_good",
    band_label: "Very good",
    metrics: [
      { key: "response", score: 92, n: 6, minimum: 5, public: true },
      { key: "reliability", score: null, n: 1, minimum: 3, public: true },
      { key: "salesmanship", score: 60, n: 7, minimum: 5, public: false },
    ],
    tips: ["1 of your 6 chats waited over a day for a first reply."],
    public_view: { new_seller: false, response: null, attention: null, band: null, band_label: null, highlights: [] },
    summary: null,
    summary_reported: false,
    how_it_works: "/help/how-anjio-rates-sellers",
  };

  test("each number with what it is based on; private ones marked", () => {
    expect(bandText(mine)).toBe("Very good (78 of 100)");
    expect(bandText({ overall: null, band_label: null })).toBe("Not enough to rate yet");
    expect(myScoreLines(mine).map(line => `${line.label}: ${line.text}${line.note ? ` (${line.note})` : ""}`)).toEqual([
      "Reply time: 92 of 100",
      "Completing sales: Not enough yet (1 of 3)",
      "How buyers rate your dealings: 60 of 100 (Private: only you and Udozo see it)",
    ]);
  });

  test("reporting the summary sends what is wrong; too short never leaves", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ reported: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    expect((await actions.reportSummary(" no ")).ok).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    await actions.reportSummary("  I sell fridges too  ");
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://api.test/v1/classifieds/me/scores/summary/report");
    expect(JSON.parse(String(init.body))).toEqual({ details: "I sell fridges too" });
  });
});

describe("How Anjio rates sellers", () => {
  test("every measure with its minimum and who sees it; salesmanship never public", () => {
    const html = renderToStaticMarkup(HelpPage());
    expect(anjioMethod.measures).toHaveLength(7);
    for (const item of anjioMethod.measures) expect(html).toContain(item.title);
    expect(anjioMethod.measures.find(item => item.key === "salesmanship")!.who).toMatch(/Never public/);
    expect(html).toContain("can be imperfect");
  });
});
