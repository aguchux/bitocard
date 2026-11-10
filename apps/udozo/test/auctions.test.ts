// Udozo auctions on udozo.com (docs/UDOZO_CONNECT_PLAN.md, phase 7b): what a lot says to each visitor, how long is
// left, the market's lots and one lot read from the API, and bidding, paying and the collection code.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { AuctionLot } from "@/lib/auctions";
import { setRequest } from "./request";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }), usePathname: () => "/ng/auctions/7" }));

const { auctionPath, lotNext, timeLeft } = await import("@/lib/auctions");
const { auctionLot, auctionsOf } = await import("@/lib/auction-reads");
const { lotCollectionCode, payLot, placeBid } = await import("@/lib/auction-actions");
const { LotActions } = await import("@/components/auction-lot");

const lot = (patch: Partial<AuctionLot> = {}): AuctionLot => ({
  object: "connect_auction",
  id: "0b7c2a1e-4d5f-4a6b-8c9d-0e1f2a3b4c5d",
  number: "AU-000007",
  ref: "7",
  status: "live",
  country: "NG",
  currency: "NGN",
  title: "Samsung TV",
  description: "",
  photos: [],
  warehouse: { name: "Udozo Lagos", state: "Lagos" },
  start_price: 1_000_000,
  current_price: null,
  next_bid: 1_000_000,
  bids: 0,
  starts_at: "2026-11-09T10:00:00Z",
  ends_at: "2026-11-12T10:00:00Z",
  rules: { step_pct: 5, step_min: 50_000, extend_minutes: 5, pay_hours: 48 },
  recent_bids: [],
  ...patch,
});

describe("a lot's words", () => {
  test("addresses and time left", () => {
    expect(auctionPath("NG")).toBe("/ng/auctions");
    expect(auctionPath("ng", "7")).toBe("/ng/auctions/7");
    const now = Date.parse("2026-11-10T10:00:00Z");
    expect(timeLeft("2026-11-10T10:00:30Z", now)).toBe("1 minute");
    expect(timeLeft("2026-11-10T13:00:00Z", now)).toBe("3 hours");
    expect(timeLeft("2026-11-13T10:00:00Z", now)).toBe("3 days");
    expect(timeLeft("2026-11-09T10:00:00Z", now)).toBe("now");
  });

  test("says what the visitor can do", () => {
    const viewer = { highest: null, leading: false, to_pay: null, won: false, seller: false };
    expect(lotNext(lot())).toBeNull();
    expect(lotNext(lot({ status: "scheduled" }))).toBe("Bidding has not opened yet.");
    expect(lotNext(lot({ viewer: { ...viewer, highest: 1_000_000, leading: true } }))).toBe("You are the highest bidder.");
    expect(lotNext(lot({ viewer: { ...viewer, highest: 1_000_000 } }))).toBe("You were outbid.");
    expect(lotNext(lot({ status: "awaiting_payment", viewer: { ...viewer, to_pay: { amount: 1_000_000, pay_by: null } } }))).toMatch(/^You won it\./);
    expect(lotNext(lot({ status: "sold", viewer: { ...viewer, won: true } }))).toMatch(/collection code/);
    expect(lotNext(lot({ viewer: { ...viewer, seller: true } }))).toMatch(/cannot bid/);
  });
});

describe("reading and acting on lots", () => {
  const calls: Array<{ method: string; path: string; body: unknown; session: string | null }> = [];
  let reply: () => Response;
  beforeEach(() => {
    calls.length = 0;
    reply = () => Response.json(lot());
    vi.stubEnv("API_URL", "http://api.test");
    setRequest({ host: "udozo.com" }, { udz_customer: "bcc_session" });
    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
      const target = new URL(url);
      calls.push({ method: init.method ?? "GET", path: target.pathname + target.search, body: init.body ? JSON.parse(String(init.body)) : undefined, session: new Headers(init.headers).get("BitoCard-Customer-Session") });
      return reply();
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  test("the market's lots, and none while the API cannot answer", async () => {
    reply = () => Response.json({ object: "list", data: [lot()] });
    expect(await auctionsOf("ng")).toMatchObject({ ok: true, lots: [{ number: "AU-000007" }] });
    expect(calls[0].path).toBe("/v1/classifieds/auctions?country=NG");
    reply = () => Response.json({ error: { code: "api_error" } }, { status: 500 });
    expect(await auctionsOf("ng")).toEqual({ ok: false, lots: [] });
  });

  test("one lot with the customer's session; a made-up reference is never asked", async () => {
    expect(await auctionLot("7")).toMatchObject({ ref: "7" });
    expect(calls[0]).toMatchObject({ path: "/v1/classifieds/auctions/7", session: "bcc_session" });
    expect(await auctionLot("../7")).toBeNull();
    expect(calls).toHaveLength(1);
  });

  test("bids, pays and reads the collection code", async () => {
    await placeBid("7", 1_050_000);
    await payLot("7");
    reply = () => Response.json({ code: "123456", collected_at: null });
    expect(await lotCollectionCode("7")).toEqual({ ok: true, data: { code: "123456", collected_at: null } });
    expect(calls.map(call => [call.method, call.path, call.body])).toEqual([
      ["POST", "/v1/classifieds/auctions/7/bids", { amount: 1_050_000 }],
      ["POST", "/v1/classifieds/auctions/7/pay", {}],
      ["GET", "/v1/classifieds/auctions/7/collection-code", undefined],
    ]);
  });

  test("refusals: a bad bid is never sent, the API's reason is told, a lost session asks to sign in", async () => {
    expect(await placeBid("7", 0)).toMatchObject({ ok: false, param: "amount" });
    expect(await placeBid("x", 100)).toMatchObject({ ok: false });
    expect(calls).toHaveLength(0);
    reply = () => Response.json({ error: { code: "bid_too_low", message: "Bid at least ₦10,500.", param: "amount" } }, { status: 400 });
    expect(await placeBid("7", 1)).toMatchObject({ ok: false, code: "bid_too_low", message: "Bid at least ₦10,500.", signIn: false });
    reply = () => Response.json({ error: { code: "authentication_required", message: "Sign in." } }, { status: 401 });
    expect(await payLot("7")).toMatchObject({ ok: false, signIn: true });
  });
});

describe("the lot's controls", () => {
  const viewer = { highest: null, leading: false, to_pay: null, won: false, seller: false };
  const shown = (value: AuctionLot) => renderToStaticMarkup(createElement(LotActions, { lot: value }));

  test("signed out: sign in to bid, back to the lot", () => {
    expect(shown(lot())).toContain('href="/signin?next=%2Fng%2Fauctions%2F7"');
  });

  test("signed in: a bid at least the next step; nothing for the seller or a closed lot", () => {
    const html = shown(lot({ viewer }));
    expect(html).toContain("Place bid");
    expect(html).toContain('value="10,000"');
    expect(shown(lot({ viewer: { ...viewer, seller: true } }))).not.toContain("bid");
    expect(shown(lot({ status: "unsold", viewer }))).not.toMatch(/<(button|input|a) /);
  });

  test("the winner pays, then shows the collection code", () => {
    expect(shown(lot({ status: "awaiting_payment", viewer: { ...viewer, to_pay: { amount: 1_050_000, pay_by: "2026-11-12T10:00:00Z" } } }))).toContain("Pay ₦10,500");
    expect(shown(lot({ status: "sold", viewer: { ...viewer, won: true } }))).toContain("Show my collection code");
  });
});
