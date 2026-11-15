// Bank deposits: Add funds offers paying cash into, or transferring to, Golojan's account where the market takes them
// (the only way in while no gateway is on); starting one opens its page; "I've sent it" says how and from whom.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { StoreBankDepositOptions, StoreWallet } from "@bitocard/api-client/storefront";
import { setRequest } from "./request";

const redirect = vi.fn((url: string) => {
  throw new Error(`redirect:${url}`);
});
const revalidatePath = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (url: string) => redirect(url) }));
vi.mock("next/cache", () => ({ revalidatePath: (path: string) => revalidatePath(path) }));

const { AddFunds } = await import("@/components/app/wallet-forms");
const { markDepositSent, startBankDeposit } = await import("@/lib/bank-deposits");

type Call = [string, RequestInit & { headers: Record<string, string> }];
const form = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const bodyOf = (call: Call) => JSON.parse(String(call[1].body));

const wallet = (methods: unknown[]) =>
  ({
    mode: "live",
    currency: "NGN",
    balance: 0,
    enabled: true,
    top_up_methods: methods,
    reserved_accounts: [],
    reserved_accounts_available: false,
    reserved_account_needs_bvn: false,
    wallets: [{ currency: "NGN", primary: true, balance: 0, removable: false }],
  }) as unknown as StoreWallet;
const options: StoreBankDepositOptions = {
  object: "bank_deposit_options",
  country: "NG",
  currency: "NGN",
  available: true,
  accounts: [{ object: "deposit_bank_account", id: "a1", country: "NG", currency: "NGN", bank_name: "Zenith Bank", account_name: "De-Golojan Technologies Ltd", account_number: "1012345678", details: null }],
  min_amount: 100,
  window_hours: 72,
};
const card = { object: "payment_method", id: "stripe", label: "Card", description: "Visa, Mastercard", networks: [] };

beforeEach(() => {
  vi.stubEnv("API_URL", "http://api.test");
  vi.stubEnv("STOREFRONT_URL", "https://bitocard.com");
  setRequest({ host: "bitocard.com" }, { bc_customer: "bcc_session" });
  redirect.mockClear();
  revalidatePath.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Add funds", () => {
  test("bank deposits sit beside the card form where offered", () => {
    const html = renderToStaticMarkup(createElement(AddFunds, { wallet: wallet([card]), bankDeposits: options }));
    expect(html).toContain("Continue to payment");
    expect(html).toContain("Bank deposit or transfer");
    expect(html).toContain('name="account_id" value="a1"');
  });

  test("with no gateway on, the bank deposit is the only way in", () => {
    const html = renderToStaticMarkup(createElement(AddFunds, { wallet: wallet([]), bankDeposits: options }));
    expect(html).not.toContain("Continue to payment");
    expect(html).toContain("Get the account details");
  });

  test("not offered: no bank deposit section", () => {
    const html = renderToStaticMarkup(createElement(AddFunds, { wallet: wallet([card]), bankDeposits: { ...options, available: false, accounts: [] } }));
    expect(html).not.toContain("Bank deposit or transfer");
  });
});

describe("bank deposit actions", () => {
  test("starting one sends the amount in minor units and opens its page", async () => {
    const fetch = vi.fn(async () => reply({ object: "bank_deposit", id: "d1" }, 201));
    vi.stubGlobal("fetch", fetch);
    await expect(startBankDeposit({}, form({ amount: "5,000", currency: "NGN", account_id: "a1" }))).rejects.toThrow("redirect:/account/wallet/deposits/d1");
    const call = (fetch.mock.calls as unknown as Call[])[0];
    expect(call[0]).toBe("http://api.test/v1/store/wallet/bank-deposits");
    expect(bodyOf(call)).toEqual({ amount: 500_000, currency: "NGN", account_id: "a1" });
  });

  test("a refusal is shown on the form", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply({ error: { type: "conflict_error", code: "too_many_deposits", message: "You have 3 bank deposits waiting." } }, 409)));
    expect(await startBankDeposit({}, form({ amount: "10" }))).toMatchObject({ error: "You have 3 bank deposits waiting." });
    expect(await startBankDeposit({}, form({ amount: "0" }))).toMatchObject({ field: "amount" });
  });

  test("I've sent it: how they paid and the sender's name", async () => {
    const fetch = vi.fn(async () => reply({ object: "bank_deposit", id: "d1", status: "sent" }));
    vi.stubGlobal("fetch", fetch);
    expect(await markDepositSent({}, form({ id: "d1", method: "cash", sender_name: "Ada Obi", note: "" }))).toMatchObject({ notice: expect.stringMatching(/checking our bank/) });
    const call = (fetch.mock.calls as unknown as Call[])[0];
    expect(call[0]).toBe("http://api.test/v1/store/wallet/bank-deposits/d1/sent");
    expect(bodyOf(call)).toEqual({ method: "cash", sender_name: "Ada Obi" });
    expect(revalidatePath).toHaveBeenCalledWith("/account/wallet");
    expect(await markDepositSent({}, form({ id: "d1", method: "card", sender_name: "Ada" }))).toMatchObject({ field: "method" });
  });
});
