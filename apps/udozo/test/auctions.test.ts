// Udozo's own lots on udozo.com (docs/UDOZO_AUCTIONS_PLAN.md, slice 3): an abandoned item's lot is an auction listing,
// paid from the wallet and collected at Udozo's warehouse on the listing's own panel; a lot's old address redirects to
// its listing; and how long is left.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ShopListingAuction } from "@bitocard/api-client/classifieds";
import { setRequest } from "./request";

const redirects: string[] = [];
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined }),
  usePathname: () => "/ng/l/9-samsung-tv",
  notFound: () => {
    throw new Error("not found");
  },
  permanentRedirect: (to: string) => {
    redirects.push(to);
    throw new Error("redirect");
  },
}));

const { auctionPath, timeLeft } = await import("@/lib/auctions");
const { lotCollectionCode, payLot } = await import("@/lib/auction-actions");
const { AuctionPanel, auctionNote, auctionState } = await import("@/components/listing-auction");
const { buyButton } = await import("@/lib/buy");
const { default: LotPage } = await import("@/app/[cc]/auctions/[ref]/page");

const viewer = { highest: null, leading: false, to_pay: null, won: false, seller: false };
const lot = (patch: Partial<ShopListingAuction> = {}): ShopListingAuction => ({
  object: "listing_auction",
  number: "AU-000007",
  ref: "7",
  kind: "abandoned",
  warehouse: { name: "Udozo Lagos", address: "1 Wharf Road, Apapa", hours: "Mon to Sat, 9 to 5", state: "Lagos" },
  status: "live",
  start_price: 1_000_000,
  current_price: null,
  next_bid: 1_000_000,
  bids: 0,
  reserve_met: null,
  starts_at: "2026-11-09T10:00:00Z",
  ends_at: "2026-11-12T10:00:00Z",
  rules: { step_pct: 5, step_min: 50_000, extend_minutes: 5, pay_hours: 48 },
  recent_bids: [],
  ...patch,
});

describe("words", () => {
  test("addresses and time left", () => {
    expect(auctionPath("NG")).toBe("/ng/auctions");
    const now = Date.parse("2026-11-10T10:00:00Z");
    expect(timeLeft("2026-11-10T10:00:30Z", now)).toBe("1 minute");
    expect(timeLeft("2026-11-10T13:00:00Z", now)).toBe("3 hours");
    expect(timeLeft("2026-11-13T10:00:00Z", now)).toBe("3 days");
    expect(timeLeft("2026-11-09T10:00:00Z", now)).toBe("now");
  });

  test("a lot of Udozo's is paid from the wallet and collected with a code; a coming one says when it opens", () => {
    expect(auctionNote(lot({ status: "awaiting_payment", viewer: { ...viewer, to_pay: { amount: 1_050_000, pay_by: null, order_id: null } } }), "NGN")).toBe("You won it at ₦10,500. Pay from your Udozo wallet, or it goes to the next bidder.");
    expect(auctionNote(lot({ status: "sold", viewer: { ...viewer, won: true } }), "NGN")).toMatch(/collection code/);
    expect(auctionState(lot({ status: "scheduled" }))).toMatch(/^Bidding opens /);
  });

  test("no UdozoPay button for a lot of Udozo's, even for its winner", () => {
    const listing = { status: "active" as const, reserved: false, price: { kind: "fixed" as const, amount: 1_000_000, currency: "NGN" }, sale_method: "auction" as const };
    const won = { own: false, order: null, auction: lot({ status: "awaiting_payment", viewer: { ...viewer, to_pay: { amount: 1, pay_by: null, order_id: null } } }) } as never;
    expect(buyButton(listing, won, "/ng/l/9/buy", true)).toBeNull();
  });
});

describe("the panel", () => {
  const shown = (auction: ShopListingAuction) => renderToStaticMarkup(createElement(AuctionPanel, { listingId: "0b7c2a1e-4d5f-4a6b-8c9d-0e1f2a3b4c5d", currency: "NGN", auction, signedIn: true, phoneConfirmed: true }));

  test("says where it is collected, and bids as any auction", () => {
    const html = shown(lot({ viewer }));
    expect(html).toContain("Place bid");
    expect(html).toContain("Udozo Lagos, 1 Wharf Road, Apapa, Lagos");
  });

  test("the winner pays from the wallet, then shows the collection code", () => {
    expect(shown(lot({ status: "awaiting_payment", viewer: { ...viewer, to_pay: { amount: 1_050_000, pay_by: null, order_id: null } } }))).toContain("Pay ₦10,500 from your wallet");
    const sold = shown(lot({ status: "sold", viewer: { ...viewer, won: true } }));
    expect(sold).toContain("Show my collection code");
    expect(sold).not.toContain("Place bid");
  });

  test("a seller's lot has neither", () => {
    const html = shown(lot({ kind: "listing", warehouse: null, status: "awaiting_payment", viewer: { ...viewer, to_pay: { amount: 1, pay_by: null, order_id: null } } }));
    expect(html).not.toContain("from your wallet");
    expect(html).not.toContain("warehouse");
  });
});

describe("talking to the API", () => {
  const calls: Array<{ method: string; path: string; body: unknown }> = [];
  let reply: () => Response;
  beforeEach(() => {
    calls.length = 0;
    redirects.length = 0;
    reply = () => Response.json({ status: "sold" });
    vi.stubEnv("API_URL", "http://api.test");
    setRequest({ host: "udozo.com" }, { udz_customer: "bcc_session" });
    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
      const target = new URL(url);
      calls.push({ method: init.method ?? "GET", path: target.pathname + target.search, body: init.body ? JSON.parse(String(init.body)) : undefined });
      return reply();
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  test("pays and reads the collection code; a made-up reference is never sent", async () => {
    await payLot("7");
    reply = () => Response.json({ code: "123456", collected_at: null });
    expect(await lotCollectionCode("7")).toEqual({ ok: true, data: { code: "123456", collected_at: null } });
    expect(await payLot("../7")).toMatchObject({ ok: false });
    expect(calls.map(call => [call.method, call.path, call.body])).toEqual([
      ["POST", "/v1/classifieds/auctions/7/pay", {}],
      ["GET", "/v1/classifieds/auctions/7/collection-code", undefined],
    ]);
    reply = () => Response.json({ error: { code: "authentication_required", message: "Sign in." } }, { status: 401 });
    expect(await payLot("7")).toMatchObject({ ok: false, signIn: true });
  });

  test("a lot's old address goes to its listing for good; one without a listing is not found", async () => {
    reply = () => Response.json({ country: "NG", listing: { ref: 9, slug: "samsung-tv" } });
    await expect(LotPage({ params: Promise.resolve({ cc: "ng", ref: "7" }) })).rejects.toThrow("redirect");
    expect(redirects).toEqual(["/ng/l/9-samsung-tv"]);
    expect(calls.at(-1)?.path).toBe("/v1/classifieds/auctions/7");
    reply = () => Response.json({ country: "NG", listing: null });
    await expect(LotPage({ params: Promise.resolve({ cc: "ng", ref: "7" }) })).rejects.toThrow("not found");
    await expect(LotPage({ params: Promise.resolve({ cc: "ng", ref: "x" }) })).rejects.toThrow("not found");
  });
});
