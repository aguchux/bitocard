// Udozo's posting journeys, udozo.com's side: every Sell says where it was pressed, opening Post an ad is counted
// (signed in or on the way through sign-in) with nothing about the visitor, and Post an ad tells the API only the step
// reached or refused and the field it needed, never what the seller typed.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { setRequest } from "./request";
import { cleanPostingStep, countSellVisit, recordPostingStep } from "@/lib/posting-actions";
import { cleanSellSource, sellHref, sellSourceOf, sellSources } from "@/lib/sell-sources";

type Call = { url: string; method: string; body: unknown };
let calls: Call[];
let answer: () => Response;

beforeEach(() => {
  vi.stubEnv("UDOZO_URL", "https://udozo.com");
  vi.stubEnv("API_URL", "https://api.test");
  calls = [];
  answer = () => Response.json({ object: "notice", message: "Noted." });
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    calls.push({ url, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : null });
    return answer();
  });
  setRequest({ host: "udozo.com" });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const listing = "4b0f1c7e-2a9d-4f3e-8c1b-5d6e7f8a9b0c";

describe("where Sell was pressed", () => {
  test("each Sell names its place, and only Udozo's own places are kept", () => {
    expect(sellHref("header")).toBe("/sell?from=header");
    expect(sellSources).toContain("header_phone");
    expect(cleanSellSource("my_listings")).toBe("my_listings");
    expect(cleanSellSource("https://evil.example")).toBe("direct");
    expect(cleanSellSource(undefined)).toBe("direct");
    expect(sellSourceOf("/sell?from=pwa")).toBe("pwa");
    expect(sellSourceOf("/sell")).toBe("direct");
    expect(sellSourceOf("/ng/l/123-tv")).toBeNull();
  });
});

describe("what Post an ad tells Udozo", () => {
  test("only the closed keys: the step and its field, never what was typed", async () => {
    expect(await cleanPostingStep({ type: "step_refused", step: "basics", param: "title", listing_id: listing })).toEqual({ type: "step_refused", step: "basics", param: "title", listing_id: listing });
    // A field Udozo does not know is dropped; so is a listing id that is not one.
    expect(await cleanPostingStep({ type: "step_refused", step: "details", param: "my number is 0803 123 4567", listing_id: "not an id" })).toEqual({ type: "step_refused", step: "details" });
    // Something smuggled in a step is never sent.
    const smuggled = { type: "step_reached", step: "media", title: "iPhone 15 Pro", price: 900000 } as unknown as Parameters<typeof cleanPostingStep>[0];
    expect(await cleanPostingStep(smuggled)).toEqual({ type: "step_reached", step: "media" });
    expect(await cleanPostingStep({ type: "step_reached", step: "anything" as never })).toBeNull();
    expect(await cleanPostingStep({ type: "sell_opened", source: "elsewhere" as never })).toEqual({ type: "sell_opened", source: "direct" });
    expect(await cleanPostingStep({ type: "form_resumed", listing_id: "x" })).toBeNull();

    await recordPostingStep({ type: "step_reached", step: "where", listing_id: listing });
    expect(calls).toEqual([{ url: "https://api.test/v1/classifieds/posting-journeys/events", method: "POST", body: { type: "step_reached", step: "where", listing_id: listing } }]);
  });

  test("a step that could not be told never troubles the seller", async () => {
    answer = () => {
      throw new Error("offline");
    };
    await expect(recordPostingStep({ type: "post_pressed" })).resolves.toBeUndefined();
    answer = () => Response.json({ error: { code: "unauthenticated", message: "Sign in." } }, { status: 401 });
    await expect(recordPostingStep({ type: "terms_ticked" })).resolves.toBeUndefined();
  });

  test("opening Post an ad is counted by where Sell was pressed, signed in or not, with nothing about the visitor", async () => {
    await countSellVisit("header", false);
    await countSellVisit("bogus" as never, true);
    expect(calls.map(call => [call.method, call.url, call.body])).toEqual([
      ["POST", "https://api.test/v1/posting-journeys/visits", { source: "header", signed_in: false }],
      ["POST", "https://api.test/v1/posting-journeys/visits", { source: "direct", signed_in: true }],
    ]);
  });
});
