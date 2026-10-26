import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { setRequest } from "./request";

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (path: string) => revalidatePath(path) }));

const actions = await import("@/lib/purchase-actions");

type Call = [string, RequestInit & { headers: Record<string, string> }];
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const order = "6f7a8b9c-0d1e-4f2a-8b3c-4d5e6f7a8b9c";
const state = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";

beforeEach(() => {
  vi.stubEnv("API_URL", "http://api.test");
  // A reseller's Resale shop: the store is named on every request.
  setRequest({ host: "gadgets.bitocard.com" }, { bc_customer: "bcc_session" });
  revalidatePath.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("buying on a Resale shop", () => {
  test("the quote and the purchase send only what the API takes, for this store, once per form", async () => {
    const fetch = vi.fn(async () => reply({ object: "classified_order", id: order }));
    vi.stubGlobal("fetch", fetch);
    await actions.quoteResale({ ref: 104233, quantity: 2, fulfilment: "meet_up", delivery_address: "ignored for a hand-over" });
    const bought = await actions.buyResale({ ref: 104233, quantity: 1, fulfilment: "delivery", delivery_address: "  12 Admiralty Way, Lekki  ", delivery_state_id: state }, 30300000, "form-nonce-1234");
    expect(bought).toMatchObject({ ok: true, data: { id: order } });
    const calls = fetch.mock.calls as unknown as Call[];
    expect(calls.map(call => [call[0], JSON.parse(String(call[1].body))])).toEqual([
      ["http://api.test/v1/store/resale/orders/quote", { ref: 104233, quantity: 2, fulfilment: "meet_up" }],
      ["http://api.test/v1/store/resale/orders", { ref: 104233, quantity: 1, fulfilment: "delivery", delivery_address: "12 Admiralty Way, Lekki", delivery_state_id: state, expected_total: 30300000 }],
    ]);
    expect(calls[1]![1].headers["idempotency-key"]).toBe("form-nonce-1234");
    expect(calls[1]![1].headers["bitocard-store"]).toBe("gadgets");
    expect(revalidatePath).toHaveBeenCalledWith("/account/purchases");
  });

  test("nonsense never reaches the API; its refusals come back as they are", async () => {
    const fetch = vi.fn(async () => reply({ error: { code: "price_changed", message: "The total is now ₦310,000.", param: "expected_total" } }, 409));
    vi.stubGlobal("fetch", fetch);
    expect(await actions.buyResale({ ref: 0, quantity: 1, fulfilment: "meet_up" }, 100, "form-nonce-1234")).toMatchObject({ ok: false });
    expect(await actions.buyResale({ ref: 1, quantity: 11, fulfilment: "meet_up" }, 100, "form-nonce-1234")).toMatchObject({ ok: false });
    expect(await actions.sendPurchaseMessage("not-an-id", "hello")).toMatchObject({ ok: false });
    expect(fetch).not.toHaveBeenCalled();
    expect(await actions.buyResale({ ref: 1, quantity: 1, fulfilment: "meet_up" }, 100, "form-nonce-1234")).toEqual({ ok: false, message: "The total is now ₦310,000.", code: "price_changed", param: "expected_total", signIn: false });
  });
});

describe("reporting a store", () => {
  test("a buyer reports this Resale shop with their order; a supplier reports one of a reseller's stores; nonsense never reaches the API", async () => {
    const fetch = vi.fn(async () => reply({ object: "resale_store_report", id: order, number: "RR-000001" }, 201));
    vi.stubGlobal("fetch", fetch);
    expect(await actions.reportStore("claims_ownership", "short", order)).toMatchObject({ ok: false, param: "details" });
    expect(await actions.reportStore("nonsense" as never, "The home page says they make the TVs.", order)).toMatchObject({ ok: false, param: "reason" });
    expect(await actions.reportStore("claims_ownership", "The home page says they make the TVs.", "not-an-id")).toMatchObject({ ok: false });
    const shop = await import("@/lib/shop-actions");
    expect(await shop.reportResellerStore("not-an-id", state, "pay_outside", "Asked my buyer to pay by transfer.")).toMatchObject({ ok: false });
    expect(fetch).not.toHaveBeenCalled();

    expect(await actions.reportStore("claims_ownership", "  The home page says they make the TVs.  ", order)).toMatchObject({ ok: true, data: { number: "RR-000001" } });
    expect(await shop.reportResellerStore(order, state, "pay_outside", "Asked my buyer to pay by transfer.")).toMatchObject({ ok: true });
    const calls = fetch.mock.calls as unknown as Call[];
    expect(calls.map(call => [call[0], JSON.parse(String(call[1].body))])).toEqual([
      ["http://api.test/v1/store/resale/reports", { reason: "claims_ownership", details: "The home page says they make the TVs.", order_id: order }],
      [`http://api.test/v1/classifieds/me/resellers/${order}/report`, { store_id: state, reason: "pay_outside", details: "Asked my buyer to pay by transfer." }],
    ]);
    expect(calls[0]![1].headers["bitocard-store"]).toBe("gadgets");
  });
});
