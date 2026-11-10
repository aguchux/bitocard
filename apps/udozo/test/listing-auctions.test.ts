// Selling by auction on udozo.com (docs/UDOZO_AUCTIONS_PLAN.md, slice 2): what cards and the listing page say of an
// auction, Post an ad's checks and what it sends, bidding, and who sees the UdozoPay button.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ShopListingAuction, ShopViewer } from "@bitocard/api-client/classifieds";
import { setRequest } from "./request";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }), usePathname: () => "/ng/l/7-sony-tv" }));

const { auctionCard } = await import("@/lib/auctions");
const { stepProblem, stepOf } = await import("@/lib/post-steps");
const { buyButton } = await import("@/lib/buy");
const { bidOnListing } = await import("@/lib/auction-actions");
const { createListing } = await import("@/lib/shop-actions");
const { AuctionPanel, auctionNote, auctionState } = await import("@/components/listing-auction");

const id = "0b7c2a1e-4d5f-4a6b-8c9d-0e1f2a3b4c5d";
const now = Date.parse("2026-11-10T10:00:00Z");
const lot = (patch: Partial<ShopListingAuction> = {}): ShopListingAuction => ({
  object: "listing_auction",
  number: "AU-000007",
  ref: "7",
  kind: "listing",
  warehouse: null,
  status: "live",
  start_price: 10_000_000,
  current_price: null,
  next_bid: 10_000_000,
  bids: 0,
  reserve_met: null,
  starts_at: "2026-11-09T10:00:00Z",
  ends_at: "2026-11-12T10:00:00Z",
  rules: { step_pct: 5, step_min: 50_000, extend_minutes: 5, pay_hours: 48 },
  recent_bids: [],
  ...patch,
});
const viewer = { highest: null, leading: false, to_pay: null, won: false, seller: false };

describe("an auction on cards and its page", () => {
  test("cards show the bid to beat, the bids and the time left", () => {
    const card = { sale_method: "auction", price: { amount: 10_000_000 }, auction: { status: "live", current_price: 12_000_000, bids: 3, ends_at: "2026-11-12T10:00:00Z" } };
    expect(auctionCard(card, now)).toEqual({ amount: 12_000_000, line: "Auction · 3 bids · ends in 2 days" });
    expect(auctionCard({ ...card, auction: { ...card.auction, current_price: null, bids: 0 } }, now)?.amount).toBe(10_000_000);
    expect(auctionCard({ ...card, auction: { ...card.auction, status: "sold" } }, now)?.line).toBe("Auction ended");
    expect(auctionCard({ sale_method: "fixed", price: { amount: 1 } }, now)).toBeNull();
  });

  test("says where it stands and the reader's place in it", () => {
    expect(auctionState(lot(), now)).toMatch(/^Ends in 2 days/);
    expect(auctionState(lot({ status: "awaiting_payment" }), now)).toBe("Bidding has ended: the winner is paying.");
    expect(auctionNote(lot({ viewer: { ...viewer, leading: true, highest: 1 } }), "NGN")).toBe("You are the highest bidder.");
    expect(auctionNote(lot({ viewer: { ...viewer, highest: 1 } }), "NGN")).toBe("You were outbid.");
    expect(auctionNote(lot({ status: "awaiting_payment", viewer: { ...viewer, to_pay: { amount: 12_000_000, pay_by: null, order_id: null } } }), "NGN")).toMatch(/^You won it at ₦120,000\. Pay with UdozoPay/);
    expect(auctionNote(lot({ viewer: { ...viewer, seller: true } }), "NGN")).toMatch(/Your listing is at auction/);
  });

  test("only the winner sees the UdozoPay button, labelled for their bid", () => {
    const listing = { status: "active" as const, reserved: false, price: { kind: "fixed" as const, amount: 10_000_000, currency: "NGN" }, sale_method: "auction" as const };
    const base = { own: false, order: null } as unknown as ShopViewer;
    expect(buyButton(listing, base, "/ng/l/7/buy", true)).toBeNull();
    expect(buyButton(listing, { ...base, auction: lot({ status: "awaiting_payment", viewer: { ...viewer, to_pay: { amount: 1, pay_by: null, order_id: null } } }) }, "/ng/l/7/buy", true)).toEqual({ href: "/ng/l/7/buy", label: "Pay for your winning bid" });
  });

  test("the panel: sign in to bid, a bid at the next step, nothing to bid for the seller", () => {
    const shown = (props: Partial<Parameters<typeof AuctionPanel>[0]>) => renderToStaticMarkup(createElement(AuctionPanel, { listingId: id, currency: "NGN", auction: lot(), signedIn: true, phoneConfirmed: true, ...props }));
    expect(shown({ signedIn: false })).toContain('href="/signin?next=%2Fng%2Fl%2F7-sony-tv"');
    expect(shown({ phoneConfirmed: false })).toContain("Confirm your mobile number to bid");
    const open = shown({});
    expect(open).toContain("Place bid");
    expect(open).toContain('value="100,000"');
    expect(shown({ auction: lot({ viewer: { ...viewer, seller: true } }) })).not.toContain("Place bid");
    expect(shown({ auction: lot({ reserve_met: false, bids: 1, current_price: 10_000_000 }) })).toContain("Reserve not met");
  });
});

describe("Post an ad", () => {
  test("an auction needs a starting price and a length; refusals open the price step", () => {
    const base = { title: "Sony TV", categoryId: "c", readyPhotos: 4, uploadingPhotos: 0, failedPhotos: 0, minPhotos: 4, priceKind: "fixed" as const, priceMinor: null, condition: "used", onShop: true, resale: false, areaId: "a" };
    expect(stepProblem(2, { ...base, saleMethod: "auction", auctionDays: 3 })?.message).toBe("Enter the starting price: bidding starts there.");
    expect(stepProblem(2, { ...base, saleMethod: "auction", priceMinor: 100, auctionDays: null })?.param).toBe("auction_days");
    expect(stepProblem(2, { ...base, saleMethod: "auction", priceMinor: 100, auctionDays: 3 })).toBeNull();
    expect([stepOf("auction_reserve"), stepOf("sale_method"), stepOf("safe_pay")]).toEqual([2, 2, 2]);
  });
});

describe("sending to the API", () => {
  const calls: Array<{ method: string; path: string; body: unknown }> = [];
  beforeEach(() => {
    calls.length = 0;
    vi.stubEnv("API_URL", "http://api.test");
    setRequest({ host: "udozo.com" }, { udz_customer: "bcc_session" });
    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
      calls.push({ method: init.method ?? "GET", path: new URL(url).pathname, body: init.body ? JSON.parse(String(init.body)) : undefined });
      return Response.json({ object: "listing_auction", id });
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  test("an auction draft sends its method, length and reserve in minor units", async () => {
    await createListing({ title: "Sony TV", sale_method: "auction", auction_days: 3, auction_reserve: "150,000" });
    await createListing({ title: "Sony TV", auction_reserve: " " });
    expect(calls.map(call => call.body)).toEqual([
      { title: "Sony TV", sale_method: "auction", auction_days: 3, auction_reserve: 15_000_000 },
      { title: "Sony TV", auction_reserve: null },
    ]);
    expect(await createListing({ auction_reserve: "lots" })).toMatchObject({ ok: false, param: "auction_reserve" });
  });

  test("a bid goes to the listing; a made-up listing or amount is never sent", async () => {
    await bidOnListing(id, 10_500_000);
    expect(calls).toEqual([{ method: "POST", path: `/v1/classifieds/listings/${id}/bids`, body: { amount: 10_500_000 } }]);
    expect(await bidOnListing("../x", 1)).toMatchObject({ ok: false });
    expect(await bidOnListing(id, 0)).toMatchObject({ ok: false, param: "amount" });
    expect(calls).toHaveLength(1);
  });
});
