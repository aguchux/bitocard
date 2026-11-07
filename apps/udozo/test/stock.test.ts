// In stock and out of stock (6 November 2026, the owner's request): a new ad starts with none in stock; the listing
// page says how many are left or that it is out of stock, and out of stock its buy buttons are closed (chat stays
// open); cards carry an Out of stock badge; My listings tags it, says when Anjio takes it off and offers Restock.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import type { ShopListingCard, ShopListingPage, ShopResaleAvailability, ShopViewer } from "@bitocard/api-client/classifieds";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/ng/l/1-tv", useSearchParams: () => new URLSearchParams() }));

const { ResaleFields, sellWhereFrom, stockFrom, stockText, outOfStockDays } = await import("@/components/account/resale-fields");
const { listingActions, listingChannelTags, listingMeta, needsRestock } = await import("@/lib/shop");
const { buyButton } = await import("@/lib/buy");
const { productMetaTags } = await import("@/lib/seo");
const { StockLine } = await import("@/components/stock");
const { ListingActions } = await import("@/components/listing-actions");
const { ListingRow, ListingTile } = await import("@/components/listing-card");

const id = "6f1c2e8a-1b2c-4d3e-8f90-1234567890ab";

describe("posting", () => {
  const open = { object: "classified_resale_availability", country: "NG", open: false, reason: "switch_off", identity_required: false, identity_checked: true, payout_account: true, ready: false, discount_min_bps: 500, discount_max_bps: 5000, markup_max_bps: 3000 } as ShopResaleAvailability;
  const fields = (stock: number) => renderToStaticMarkup(createElement(ResaleFields, { value: { ...sellWhereFrom(null, open), stock }, availability: open, priceMinor: 100000, priceOnRequest: false, currency: "NGN", invalid: () => false, onChange: () => undefined }));

  test("a new ad starts with none in stock, and the box takes 0 to 100,000", () => {
    expect(sellWhereFrom(null, open).stock).toBe(0);
    expect(outOfStockDays).toBe(90);
    expect([stockFrom(""), stockFrom("-3"), stockFrom("2.7"), stockFrom("250000"), stockFrom("4")]).toEqual([0, 0, 2, 100000, 4]);
    expect([stockText(0), stockText(1), stockText(1200)]).toEqual(["Out of stock", "1 in stock", "1,200 in stock"]);
  });

  test("the box says what none in stock means", () => {
    const none = fields(0);
    expect(none).toContain("How many do you have in stock?");
    expect(none).toContain('min="0"');
    expect(none).toContain("stays up 90 days, then Anjio takes it off unless you restock");
    expect(fields(3)).toContain("When none are left, buyers can no longer buy it.");
  });
});

describe("the listing page", () => {
  test("says how many are left, or that it is out of stock", () => {
    expect(renderToStaticMarkup(createElement(StockLine, { inStock: false, available: 0 }))).toContain("Out of stock");
    expect(renderToStaticMarkup(createElement(StockLine, { inStock: true, available: 1 }))).toContain("Last one in stock");
    expect(renderToStaticMarkup(createElement(StockLine, { inStock: true, available: 12 }))).toContain("12 in stock");
    expect(renderToStaticMarkup(createElement(StockLine, {}))).toBe("");
  });

  const page = { status: "active", reserved: false, in_stock: false, price: { kind: "fixed", amount: 2500000, currency: "NGN" } } as Pick<ShopListingPage, "status" | "reserved" | "price" | "in_stock">;
  const viewer = { object: "classified_listing_viewer", listing_id: id, own: false, favourite: false, conversation_id: null, order: null, can_contact: true, buy_orders: true, buy_order: null } as unknown as ShopViewer;

  test("out of stock, there is no Buy with Safe pay, but an order already open carries on", () => {
    expect(buyButton(page, viewer, "/ng/l/1/buy", true)).toBeNull();
    expect(buyButton({ ...page, in_stock: true }, viewer, "/ng/l/1/buy", true)?.label).toBe("Buy with Safe pay");
    expect(buyButton(page, { ...viewer, order: { id: "o1", number: "SP-100001", status: "paid" } } as ShopViewer, "/b", true)?.label).toMatch(/Continue/);
  });

  test("its buy buttons are closed and say so; chatting stays open", () => {
    const listing = { id, title: "Haier 32 inch TV", url: "https://udozo.com/ng/l/1-haier", currency: "NGN", active: true, chat: true, phone: false, buyPath: "/ng/l/1/buy", buyHref: null, buyLabel: "", price: 2500000, available: 0, buyOrders: true };
    const render = (inStock: boolean) => renderToStaticMarkup(createElement(ListingActions, { listing: { ...listing, inStock, available: inStock ? 2 : 0 }, viewer, signedIn: true, chat: null, messagesHref: "/account/messages", myPhone: null }));
    const out = render(false);
    expect(out).toMatch(/<button[^>]*disabled[^>]*>.*Out of stock/);
    expect(out).toContain("Chat with them to ask when more come in.");
    expect(out).not.toContain("Buy this");
    expect(out).toContain("Chat with seller");
    const stocked = render(true);
    expect(stocked).toContain("Buy this");
    expect(stocked).not.toContain("Out of stock");
  });

  test("search engines and link previews read it as out of stock", () => {
    const listing = { status: "active", in_stock: false, price: { kind: "fixed", amount: 2500000, currency: "NGN" }, condition: "used", category: { name: "TVs" } } as unknown as ShopListingPage;
    expect(productMetaTags(listing)["product:availability"]).toBe("out of stock");
    expect(productMetaTags({ ...listing, in_stock: true })["product:availability"]).toBe("in stock");
  });
});

describe("cards", () => {
  test("an ad out of stock carries the badge", () => {
    const card = {
      object: "classified_listing_card",
      id,
      ref: 100001,
      title: "Haier 32 inch TV",
      slug: "haier-32-inch-tv",
      country: "NG",
      url: "https://udozo.com/ng/l/100001-haier-32-inch-tv",
      price: { kind: "fixed", amount: 2500000, currency: "NGN" },
      condition: "used",
      category: { slug: "tvs", name: "TVs" },
      area: { slug: "gwarinpa", name: "Gwarinpa", state: { slug: "fct", name: "FCT" } },
      cover: null,
      photo_count: 4,
      has_video: false,
      highlights: [],
      delivery: "none",
      in_stock: false,
      seller: { name: "Ada E.", badges: [] },
      published_at: null,
    } as unknown as ShopListingCard;
    expect(renderToStaticMarkup(createElement(ListingRow, { card }))).toContain("Out of stock");
    expect(renderToStaticMarkup(createElement(ListingTile, { card: { ...card, in_stock: true } }))).not.toContain("Out of stock");
  });
});

describe("My listings", () => {
  const base = { on_shop: true, resale: { enabled: false, discount_bps: null, markup_max_bps: null, paused: false }, stock: 0, status: "active" as const };

  test("tags it out of stock, says when Anjio takes it off, and offers Restock", () => {
    expect(listingChannelTags(base)).toEqual(["Out of stock"]);
    expect(listingChannelTags({ ...base, stock: 3 })).toEqual(["3 left"]);
    expect(listingChannelTags({ ...base, status: "sold" })).toEqual([]);
    expect(listingActions({ status: "active", url: "https://udozo.com/ng/l/1-tv", stock: 0 })).toEqual(["edit", "restock", "view", "delete"]);
    expect(listingActions({ status: "expired", url: null, stock: 0 })).toEqual(["restock", "delete"]);
    expect(listingActions({ status: "expired", url: null, stock: 2 })).toEqual(["renew", "delete"]);
    expect([needsRestock({ status: "active", stock: 0 }), needsRestock({ status: "active", stock: 1 }), needsRestock({ status: "draft", stock: 0 })]).toEqual([true, false, false]);
    const meta = { views: 3, leads: 1, expires_at: "2027-02-04T10:00:00.000Z", updated_at: "2026-11-06T10:00:00.000Z", photos: [] };
    expect(listingMeta({ ...meta, status: "active", delist_at: "2027-02-04T10:00:00.000Z" })).toBe("Out of stock: Anjio takes it off on 4 February 2027 unless you restock it");
    expect(listingMeta({ ...meta, status: "expired", expired_reason: "out_of_stock" })).toMatch(/^Anjio took it off: it was out of stock/);
    expect(listingMeta({ ...meta, status: "expired", expired_reason: null })).toBe("Expired: renew it to show it again");
  });
});
