// pos.udozo.com: the shop's own customers (no Udozo account needed). The actions check what they send before calling
// the owner routes, selling on credit needs a customer, and the helpers word the list, the entries and a linked
// customer's rating on Udozo.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setRequest } from "./request";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { to });
  },
}));

const actions = await import("@/lib/pos-actions");
const { customersQuery, entryText, methodLabel, ratingText } = await import("@/lib/pos");

const customer = "3f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c";
const till = "7c6b5a49-3827-4e1d-9c0b-a1b2c3d4e5f6";
const basket = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const listing = "9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a";
const sent: Array<{ method: string; url: string; body: unknown }> = [];
let reply: () => Response = () => Response.json({ object: "pos_customer" });

beforeEach(() => {
  sent.length = 0;
  reply = () => Response.json({ object: "pos_customer", id: customer });
  setRequest({}, { udz_pos: "bcc_owner" });
  vi.stubEnv("API_URL", "https://api.udozo.test");
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    sent.push({ method: init.method ?? "GET", url: url.replace("https://api.udozo.test", ""), body: init.body ? JSON.parse(String(init.body)) : undefined });
    return reply();
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("customers' actions", () => {
  it("adds a customer with only their name, cleaning what was typed", async () => {
    expect((await actions.saveCustomer(null, { name: "  Bola Ade ", phone: " 0803 123 4567 ", email: "", notes: null, credit_limit: 500_000 })).ok).toBe(true);
    expect(sent[0]).toEqual({ method: "POST", url: "/v1/pos/owner/customers", body: { name: "Bola Ade", phone: "0803 123 4567", email: null, notes: null, credit_limit: 500_000 } });
  });

  it("changes one, and refuses a missing name, a bad credit limit or a made-up id before asking", async () => {
    await actions.saveCustomer(customer, { address: "12 Broad Street", credit_limit: null });
    expect(sent[0]).toEqual({ method: "PATCH", url: `/v1/pos/owner/customers/${customer}`, body: { address: "12 Broad Street", credit_limit: null } });
    expect(await actions.saveCustomer(null, { name: " " })).toMatchObject({ ok: false, param: "name" });
    expect(await actions.saveCustomer(customer, { credit_limit: -1 })).toMatchObject({ ok: false, param: "credit_limit" });
    expect(await actions.saveCustomer("nope", { name: "Bola" })).toMatchObject({ ok: false, code: "resource_missing" });
    expect(sent).toHaveLength(1);
  });

  it("shows the API's refusal in its own words", async () => {
    reply = () => Response.json({ error: { type: "conflict_error", code: "customer_phone_taken", message: "Another customer has this mobile number.", param: "phone" } }, { status: 409 });
    expect(await actions.saveCustomer(null, { name: "Bola", phone: "08031234567" })).toEqual({ ok: false, message: "Another customer has this mobile number.", code: "customer_phone_taken", param: "phone" });
  });

  it("records a repayment as it was paid, never by Udozo wallet or on credit", async () => {
    await actions.repayCustomer(customer, 50_000, "transfer", " TRF-1 ");
    expect(sent[0]).toEqual({ method: "POST", url: `/v1/pos/owner/customers/${customer}/repayments`, body: { amount: 50_000, method: "transfer", reference: "TRF-1" } });
    expect(await actions.repayCustomer(customer, 0, "cash")).toMatchObject({ ok: false, param: "amount" });
    expect(await actions.repayCustomer(customer, 100, "credit" as never)).toMatchObject({ ok: false, param: "method" });
    expect(sent).toHaveLength(1);
  });

  it("removes one, and finds customers for the till", async () => {
    reply = () => new Response(null, { status: 204 });
    expect((await actions.removeCustomer(customer)).ok).toBe(true);
    expect(sent[0]).toMatchObject({ method: "DELETE", url: `/v1/pos/owner/customers/${customer}` });
    reply = () => Response.json({ object: "list", summary: { owing: 0, owed: 0 }, total: 1, has_more: false, data: [{ id: customer, name: "Bola Ade" }] });
    expect(await actions.findCustomers(" bola ")).toMatchObject({ ok: true, data: [{ id: customer }] });
    expect(sent[1]!.url).toBe("/v1/pos/owner/customers?limit=8&q=bola");
  });

  it("sells on credit only to a chosen customer, and sends the customer with the sale", async () => {
    const sale = { till_id: till, client_sale_id: basket, lines: [{ listing_id: listing, quantity: 1 }], payments: [{ method: "credit" as const, amount: 10_000 }], expected_total: 10_000 };
    expect(await actions.ringUp(sale)).toMatchObject({ ok: false, param: "customer_id" });
    expect(sent).toHaveLength(0);
    reply = () => Response.json({ object: "pos_sale", id: "s1" });
    expect((await actions.ringUp({ ...sale, customer_id: customer })).ok).toBe(true);
    expect(sent[0]!.body).toMatchObject({ payments: [{ method: "credit", amount: 10_000 }], customer_id: customer });
    expect(await actions.ringUp({ ...sale, customer_id: "nope" })).toMatchObject({ ok: false, param: "customer_id" });
  });

  it("asks a Udozo wallet payment for the chosen customer", async () => {
    reply = () => Response.json({ object: "pos_wallet_request", id: "w1", token: "t", pay_url: "https://udozo.test/pos/pay/t" });
    await actions.askWallet({ till_id: till, client_sale_id: basket, lines: [{ listing_id: listing, quantity: 1 }], payments: [], expected_total: 10_000, wallet_amount: 10_000, phone: "+234 803-123-4567", customer_id: customer });
    expect(sent[0]!.body).toMatchObject({ phone: "+2348031234567", customer_id: customer });
  });
});

describe("customers' words", () => {
  it("reads the list's filters from the address", () => {
    expect(customersQuery({ q: " bola ", owing: "1", page: "3" })).toEqual({ q: "bola", owing: true, page: 3, api: "?limit=25&offset=50&q=bola&owing=true" });
    expect(customersQuery({ page: "-2" })).toEqual({ q: "", owing: false, page: 1, api: "?limit=25&offset=0" });
  });

  it("words each line of what they owe and how a sale was paid", () => {
    expect(entryText({ kind: "credit_sale", method: null })).toBe("Bought on credit");
    expect(entryText({ kind: "repayment", method: "transfer" })).toBe("Paid back (transfer)");
    expect(entryText({ kind: "refund", method: null })).toBe("Refunded");
    expect(methodLabel("credit")).toBe("Pay later");
  });

  it("words a linked customer's rating on Udozo", () => {
    expect(ratingText({ member_since: "2025-03-01T00:00:00.000Z", in_good_standing: true, reviews: { positive: 9, neutral: 0, negative: 1, counted: 10, positive_pct: 90 }, scores: { band: "Very good" } })).toBe("90% positive from 10 reviews · Very good · on Udozo since March 2025");
    expect(ratingText({ member_since: "2026-01-15T00:00:00.000Z", in_good_standing: false, reviews: null, scores: null })).toBe("on Udozo since January 2026 · their Udozo account is suspended");
  });
});
