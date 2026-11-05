import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ShopBuyOrder, ShopBuyOrderSummary } from "@bitocard/api-client/classifieds";
import { setRequest } from "./request";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/ng/l/100001-tv" }));

const { buyOrderNext, buyOrderTone, buyQuestion } = await import("@/lib/buy-orders");
const actions = await import("@/lib/buy-order-actions");
const { BuyOrderCard, BuyOrderControls, BuyOrderSheet } = await import("@/components/buy-order");

type Call = [string, RequestInit & { headers: Record<string, string> }];
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const listing = "0b7c2a1e-4d5f-4a6b-8c9d-0e1f2a3b4c5d";
const id = "6f7a8b9c-0d1e-4f2a-8b3c-4d5e6f7a8b9c";

const summary: ShopBuyOrderSummary = { object: "classified_buy_order", id, number: "BO-000012", status: "requested", role: "seller", price: 24_000_000, counter: null, currency: "NGN", quantity: 1, actions: ["accept", "counter", "decline"] };
const order: ShopBuyOrder = {
  ...summary,
  listing: { id: listing, ref: 100001, title: "Hisense 50 inch TV", path: "/ng/l/100001-hisense-50-inch-tv", status: "active", cover_url: null, price: { kind: "fixed", amount: 25_000_000, currency: "NGN" } },
  with: { name: "Kemi A." },
  note: null,
  meet_note: "Gwarinpa mall",
  conversation_id: null,
  respond_by: "2026-11-07T10:00:00Z",
  meet_by: null,
  meet_extended: false,
  accepted_at: null,
  bought_at: null,
  completes_at: null,
  completed_at: null,
  completed_by: null,
  void_until: null,
  ended_by: null,
  end_reason: null,
  created_at: "2026-11-05T10:00:00Z",
  updated_at: "2026-11-05T10:00:00Z",
};

beforeEach(() => {
  vi.stubEnv("API_URL", "http://api.test");
  setRequest({ host: "udozo.com" }, { udz_customer: "bcc_session" });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("buy orders' words", () => {
  test("what to do next, from each side, with its deadline", () => {
    expect(buyOrderNext(order)).toMatch(/^Accept, offer another price or decline by /);
    expect(buyOrderNext({ ...order, role: "buyer" })).toBe("Waiting for Kemi A. to answer.");
    expect(buyOrderNext({ ...order, status: "countered", role: "buyer" })).toMatch(/^Accept their price or cancel by /);
    expect(buyOrderNext({ ...order, status: "accepted", meet_by: "2026-11-12T10:00:00Z" })).toMatch(/Mark it sold once they have bought it\.$/);
    expect(buyOrderNext({ ...order, status: "accepted", bought_at: "2026-11-06T10:00:00Z" })).toBe("Kemi A. says they bought it: mark it sold to confirm.");
    expect(buyOrderNext({ ...order, status: "completed", role: "buyer", void_until: "2026-11-12T10:00:00Z" })).toMatch(/^Recorded\. Did not buy it\? Say so by /);
    expect(buyOrderNext({ ...order, status: "lapsed" })).toBe("Ended.");
    expect([buyOrderTone("accepted"), buyOrderTone("requested"), buyOrderTone("voided"), buyOrderTone("cancelled")]).toEqual(["bg-emerald-50 text-emerald-800", "bg-amber-50 text-amber-800", "bg-red-50 text-red-800", "bg-slate-100 text-slate-700"]);
  });

  test("every step asks first, saying what happens; saying you did not buy needs a reason", () => {
    expect(buyQuestion("accept", order)).toMatchObject({ action: "Accept ₦240,000", tone: "money" });
    expect(buyQuestion("counter", order, 24_500_000).action).toBe("Offer ₦245,000");
    expect(buyQuestion("complete", order).body).toMatch(/Only once they have paid you/);
    expect(buyQuestion("void", order).reason).toMatchObject({ required: true });
    expect(buyQuestion("cancel", order)).toMatchObject({ tone: "danger", dismiss: "Keep it" });
    for (const action of ["decline", "accept_counter", "no_show", "extend", "bought"] as const) expect(buyQuestion(action, order).action).toBeTruthy();
  });
});

describe("buy order actions", () => {
  test("asking sends the price in minor units with the nonce, notes trimmed; bad input never leaves", async () => {
    const fetch = vi.fn(async () => reply(order, 201));
    vi.stubGlobal("fetch", fetch);
    const result = await actions.createBuyOrder(listing, { price: 24_000_000, quantity: 1, note: "  Can you deliver?  ", meet_note: "" }, "buy-order-nonce-1");
    expect(result.ok).toBe(true);
    const [url, init] = fetch.mock.calls[0] as unknown as Call;
    expect(url).toBe(`http://api.test/v1/classifieds/listings/${listing}/buy-orders`);
    expect(JSON.parse(String(init.body))).toEqual({ price: 24_000_000, quantity: 1, note: "Can you deliver?" });
    expect(init.headers["idempotency-key"] ?? init.headers["Idempotency-Key"]).toBe("buy-order-nonce-1");
    expect((await actions.createBuyOrder("nope", { price: 1, quantity: 1 })).ok).toBe(false);
    expect((await actions.createBuyOrder(listing, { price: 0, quantity: 1 })).ok).toBe(false);
    expect((await actions.createBuyOrder(listing, { price: 10, quantity: 0 })).ok).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("steps post to their hyphenated address; a counter needs a price; the API's refusal is shown", async () => {
    const fetch = vi.fn(async () => reply(order));
    vi.stubGlobal("fetch", fetch);
    await actions.buyOrderStep(id, "accept_counter");
    await actions.buyOrderStep(id, "void", { reason: " Never met " });
    const calls = fetch.mock.calls as unknown as Call[];
    expect(calls.map(([url]) => url)).toEqual([`http://api.test/v1/classifieds/buy-orders/${id}/accept-counter`, `http://api.test/v1/classifieds/buy-orders/${id}/void`]);
    expect(JSON.parse(String(calls[1]![1].body))).toEqual({ reason: "Never met" });
    expect((await actions.buyOrderStep(id, "counter")).ok).toBe(false);
    vi.stubGlobal("fetch", vi.fn(async () => reply({ error: { type: "conflict_error", code: "out_of_stock", message: "Every one of these is already held for other buyers." } }, 409)));
    expect(await actions.buyOrderStep(id, "accept")).toMatchObject({ ok: false, code: "out_of_stock", message: "Every one of these is already held for other buyers." });
  });

  test("Mark sold reads the listing's accepted buy orders; none when the API cannot answer", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply({ object: "list", data: [order], waiting: 0 })));
    expect((await actions.acceptedBuyOrders(listing)).map(item => item.id)).toEqual([id]);
    vi.stubGlobal("fetch", vi.fn(async () => reply({ error: { code: "x", message: "x" } }, 500)));
    expect(await actions.acceptedBuyOrders(listing)).toEqual([]);
    expect(await actions.acceptedBuyOrders("nope")).toEqual([]);
  });
});

describe("buy order screens", () => {
  test("the form starts at the asking price, offers how many when there are several, and says payment is in person", () => {
    const html = renderToStaticMarkup(createElement(BuyOrderSheet, { dialog: { current: null }, listing: { id: listing, title: "Hisense 50 inch TV", currency: "NGN", price: 25_000_000, available: 3 }, onSent: () => undefined }));
    expect(html).toContain('value="250,000"');
    expect(html).toContain("How many");
    expect(html).toMatch(/pay them in person/);
    expect(html).toContain("Send buy order");
    const one = renderToStaticMarkup(createElement(BuyOrderSheet, { dialog: { current: null }, listing: { id: listing, title: "TV", currency: "NGN", price: null, available: 1 }, onSent: () => undefined }));
    expect(one).not.toContain("How many");
  });

  test("a chat card shows the step, the order's price and status, and opens it", () => {
    const html = renderToStaticMarkup(createElement(BuyOrderCard, { body: "Asked to buy for ₦240,000.", order: summary, mine: false }));
    expect(html).toContain("Buy order BO-000012");
    expect(html).toContain("Answer the buyer");
    expect(html).toContain(`href="/account/buy-orders/${id}"`);
    expect(html).toContain("Open and answer");
    expect(renderToStaticMarkup(createElement(BuyOrderCard, { body: "Marked sold.", order: { ...summary, status: "completed", actions: [] }, mine: true }))).toContain("Open the buy order");
  });

  test("the order page's buttons are the reader's steps, in plain words; none once it has ended", () => {
    const html = renderToStaticMarkup(createElement(BuyOrderControls, { order }));
    expect(["Accept", "Offer another price", "Decline"].every(word => html.includes(`>${word}</button>`))).toBe(true);
    const buyer = renderToStaticMarkup(createElement(BuyOrderControls, { order: { ...order, role: "buyer", status: "accepted", actions: ["bought", "no_show", "cancel"] } }));
    expect(buyer).toContain(">I bought it</button>");
    expect(buyer).toContain(">It did not happen</button>");
    expect(renderToStaticMarkup(createElement(BuyOrderControls, { order: { ...order, status: "lapsed", actions: [] } }))).toBe("");
  });
});
