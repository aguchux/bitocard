// pos.udozo.com: Udozo collection accounts (milestone 4). The actions check what they send before calling the owner
// routes; a paid transfer request hands back the sale it made; and the helpers word where accounts, transfers and
// settlements stand.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setRequest } from "./request";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { to });
  },
}));

const actions = await import("@/lib/pos-actions");
const { collectionBlockText, collectionText, dayText, methodLabel, settlementText, transferOutcome } = await import("@/lib/pos");

const till = "7c6b5a49-3827-4e1d-9c0b-a1b2c3d4e5f6";
const account = "3f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c";
const basket = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const listing = "9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a";
const sent: Array<{ method: string; url: string; body: unknown }> = [];
let reply: (url: string) => Response = () => Response.json({});

beforeEach(() => {
  sent.length = 0;
  reply = () => Response.json({ object: "pos_collection_account", id: account });
  setRequest({}, { udz_pos: "bcc_owner" });
  vi.stubEnv("API_URL", "https://api.udozo.test");
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    const path = url.replace("https://api.udozo.test", "");
    sent.push({ method: init.method ?? "GET", url: path, body: init.body ? JSON.parse(String(init.body)) : undefined });
    return reply(path);
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("collection accounts' actions", () => {
  it("chooses where collections are paid, or none", async () => {
    reply = () => Response.json({ object: "pos_collections" });
    await actions.setSettlementAccount(account);
    await actions.setSettlementAccount(null);
    expect(sent.map(call => [call.method, call.url, call.body])).toEqual([
      ["PUT", "/v1/pos/owner/collections/settlement-account", { bank_account_id: account }],
      ["PUT", "/v1/pos/owner/collections/settlement-account", { bank_account_id: null }],
    ]);
    expect(await actions.setSettlementAccount("nope")).toMatchObject({ ok: false, param: "bank_account_id" });
  });

  it("opens a till's account with the BVN cleaned, and never sends a BVN that is not 11 digits", async () => {
    await actions.openCollectionAccount(till, " 2234 5678 901 ");
    expect(sent[0]).toEqual({ method: "POST", url: `/v1/pos/owner/tills/${till}/collection-account`, body: { bvn: "22345678901" } });
    await actions.openCollectionAccount(till);
    expect(sent[1]!.body).toEqual({});
    expect(await actions.openCollectionAccount(till, "1234")).toMatchObject({ ok: false, param: "bvn" });
    expect(await actions.openCollectionAccount("nope")).toMatchObject({ ok: false, code: "resource_missing" });
    expect(sent).toHaveLength(2);
  });

  it("shows the bank's refusal in its own words", async () => {
    reply = () => Response.json({ error: { type: "conflict_error", code: "settlement_account_required", message: "Choose the bank account your collections are paid to first.", param: "settlement_bank_account_id" } }, { status: 409 });
    expect(await actions.openCollectionAccount(till)).toEqual({ ok: false, message: "Choose the bank account your collections are paid to first.", code: "settlement_account_required", param: "settlement_bank_account_id" });
  });

  it("closes an account, sends a sandbox test transfer, and attaches or keeps an unmatched one", async () => {
    await actions.closeCollectionAccount(account);
    await actions.simulateCollection(account, 250_000, " TEST PAYER ");
    await actions.attachCollection(account, basket);
    await actions.keepCollection(account, "  A deposit ");
    expect(sent.map(call => [call.url, call.body])).toEqual([
      [`/v1/pos/owner/collection-accounts/${account}/close`, undefined],
      [`/v1/pos/owner/collection-accounts/${account}/simulate`, { amount: 250_000, payer_name: "TEST PAYER" }],
      [`/v1/pos/owner/collections/transfers/${account}/attach`, { transfer_request_id: basket }],
      [`/v1/pos/owner/collections/transfers/${account}/keep`, { note: "A deposit" }],
    ]);
    expect(await actions.simulateCollection(account, 0)).toMatchObject({ ok: false, param: "amount" });
    expect(await actions.attachCollection(account, "nope")).toMatchObject({ ok: false, param: "transfer_request_id" });
  });

  it("asks for the rest of a basket by transfer, and a paid request comes back with its sale", async () => {
    reply = () => Response.json({ object: "pos_transfer_request", id: basket, status: "waiting" });
    const asked = await actions.askTransfer({ till_id: till, client_sale_id: basket, lines: [{ listing_id: listing, quantity: 2 }], payments: [{ method: "cash", amount: 200_000, tendered: 200_000 }], transfer_amount: 800_000, expected_total: 1_000_000 });
    expect(asked.ok).toBe(true);
    expect(sent[0]).toEqual({
      method: "POST",
      url: "/v1/pos/owner/transfer-requests",
      body: { till_id: till, client_sale_id: basket, lines: [{ listing_id: listing, quantity: 2 }], payments: [{ method: "cash", amount: 200_000, tendered: 200_000 }], transfer_amount: 800_000, expected_total: 1_000_000 },
    });
    expect(await actions.askTransfer({ till_id: till, client_sale_id: basket, lines: [{ listing_id: listing, quantity: 1 }], payments: [], transfer_amount: 0, expected_total: 0 })).toMatchObject({ ok: false, param: "transfer_amount" });

    reply = url => (url.includes("/sales/") ? Response.json({ object: "pos_sale", id: "s1", number: "POS-000004" }) : Response.json({ object: "pos_transfer_request", id: basket, status: "paid", sale_id: "5e0d2a1b-9c8f-4d3e-8b7a-6f5e4d3c2b1a" }));
    const paid = await actions.transferStatus(basket);
    expect(paid).toMatchObject({ ok: true, data: { status: "paid", sale: { number: "POS-000004" } } });
    expect(sent.at(-1)!.url).toBe("/v1/pos/owner/sales/5e0d2a1b-9c8f-4d3e-8b7a-6f5e4d3c2b1a");

    await actions.cancelTransfer(basket);
    expect(sent.at(-1)).toMatchObject({ method: "POST", url: `/v1/pos/owner/transfer-requests/${basket}/cancel` });
  });
});

describe("collections' words", () => {
  it("says why an account cannot be opened yet", () => {
    expect(collectionBlockText("plan")).toBe("Collection accounts come with Premium and Multi-shop.");
    expect(collectionBlockText("settlement_account")).toBe("Choose the bank account your collections are paid to first.");
    expect(collectionBlockText("unavailable")).toMatch(/not open in your country/);
    expect(collectionBlockText(null)).toBeNull();
  });

  it("says where a settlement stands", () => {
    const bank = { bank_name: "Sandbox Bank", last4: "6789" };
    expect(settlementText({ status: "paying", kept_reason: null, bank_account: bank, payout: { id: "p", status: "processing", completed_at: null } })).toBe("On its way to Sandbox Bank ••••6789.");
    expect(settlementText({ status: "paying", kept_reason: null, bank_account: bank, payout: { id: "p", status: "paid", completed_at: "2026-11-12T09:00:00Z" } })).toBe("Paid to Sandbox Bank ••••6789.");
    expect(settlementText({ status: "paying", kept_reason: null, bank_account: bank, payout: { id: "p", status: "failed", completed_at: null } })).toMatch(/refused it/);
    expect(settlementText({ status: "kept", kept_reason: "The smallest payout is NGN 15,000.00.", bank_account: null, payout: null })).toBe("In your Udozo payouts: The smallest payout is NGN 15,000.00.");
  });

  it("words transfers, the till's outcome and the payment method", () => {
    expect(collectionText({ status: "matched", sale: { id: "s", number: "POS-000004" }, note: null })).toBe("Paid POS-000004");
    expect(collectionText({ status: "kept", sale: null, note: "A deposit" })).toBe("Kept: A deposit");
    expect(collectionText({ status: "unmatched", sale: null, note: null })).toBe("Not matched to a sale yet");
    expect(transferOutcome({ status: "expired", failure: null })).toMatch(/30 minutes/);
    expect(transferOutcome({ status: "failed", failure: "Only 1 of “TV” left to sell." })).toMatch(/Only 1/);
    expect(transferOutcome({ status: "waiting", failure: null })).toBeNull();
    expect(methodLabel("udozo_transfer")).toBe("Transfer to your Udozo account");
    expect(dayText("2099-03-25")).toBe("Wed 25 Mar");
  });
});
