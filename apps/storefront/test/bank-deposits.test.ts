// Bank deposits: Add funds offers paying cash into, or transferring to, Golojan's account where the market takes them
// (the only way in while no gateway is on); starting one opens its page; "I've sent it" says how and from whom.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { StoreBankDeposit, StoreBankDepositOptions, StoreWallet } from "@bitocard/api-client/storefront";
import { setRequest } from "./request";

const redirect = vi.fn((url: string) => {
  throw new Error(`redirect:${url}`);
});
const revalidatePath = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (url: string) => redirect(url) }));
vi.mock("next/cache", () => ({ revalidatePath: (path: string) => revalidatePath(path) }));

const { AddFunds } = await import("@/components/app/wallet-forms");
const { markDepositSent, startBankDeposit } = await import("@/lib/bank-deposits");
const { DepositRows } = await import("@/components/app/bank-deposit-status");
const { default: DepositsPage } = await import("@/app/(app)/account/wallet/deposits/page");

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
  test("one amount, then branded gateways and bank deposit; the first gateway is chosen", () => {
    const paystack = { ...card, id: "paystack", label: "Card, bank or USSD", description: "Cards and bank transfer" };
    const flutterwave = { ...card, id: "flutterwave", label: "Card, bank or mobile money", description: "Cards and mobile money" };
    const html = renderToStaticMarkup(createElement(AddFunds, { wallet: wallet([card, paystack, flutterwave]), bankDeposits: options }));
    expect(html.match(/name="amount"/g)).toHaveLength(1);
    expect(html).toContain('checked="" value="stripe"');
    for (const [id, name] of [["stripe", "Stripe"], ["paystack", "Paystack"], ["flutterwave", "Flutterwave"]]) {
      expect(html).toContain(`value="${id}"`);
      expect(html).toContain(`src="/payment-gateways/${id}.svg"`);
      expect(html).toContain(`>${name}</span>`);
    }
    expect(html).toContain("Cards and bank transfer");
    expect(html).not.toContain(">Card, bank or USSD</span>");
    expect(html).toContain('value="bank_deposit"');
    expect(html).toContain("Bank deposit");
    expect(html).toContain("Continue to payment");
    expect(html).not.toContain("Get the account details");
  });

  test("with no gateway on, the bank deposit is the only way in", () => {
    const html = renderToStaticMarkup(createElement(AddFunds, { wallet: wallet([]), bankDeposits: options }));
    expect(html).not.toContain("Continue to payment");
    expect(html).toContain('checked="" value="bank_deposit"');
    expect(html).toContain("Get the account details");
    expect(html).toContain('name="account_id" value="a1"');
  });

  test("the amount is a money field: the wallet's sign inside it, an amount keyboard, read in the wallet's currency", () => {
    const html = renderToStaticMarkup(createElement(AddFunds, { wallet: wallet([card]), bankDeposits: options, amount: "25000" }));
    expect(html).toMatch(/<span aria-hidden="true"[^>]*>₦<\/span><input[^>]*name="amount"/);
    expect(html).toMatch(/name="amount"[^>]*inputMode="decimal"|inputMode="decimal"[^>]*name="amount"/);
    expect(html).toContain('value="25,000"');
    expect(html).toContain('name="amount_currency" value="NGN"');
    expect(html).not.toContain("Amount (NGN)");
  });

  test("not offered: no bank deposit section", () => {
    const html = renderToStaticMarkup(createElement(AddFunds, { wallet: wallet([card]), bankDeposits: { ...options, available: false, accounts: [] } }));
    expect(html).not.toContain("bank_deposit");
  });
});

const deposit = (over: Partial<StoreBankDeposit>): StoreBankDeposit => ({
  object: "bank_deposit",
  id: "d1",
  number: "BD-000001",
  mode: "live",
  status: "sent",
  currency: "NGN",
  amount: 500_000,
  credited_amount: null,
  reference: "BCAB12CD34",
  account: { bank_name: "Zenith Bank", account_name: "De-Golojan Technologies Ltd", account_number: "1012345678", details: null },
  method: "cash",
  sender_name: "Ada Obi",
  note: null,
  decision_note: null,
  expires_at: "2026-11-19T10:00:00Z",
  sent_at: "2026-11-16T11:00:00Z",
  decided_at: null,
  created_at: "2026-11-16T10:00:00Z",
  ...over,
});

describe("Deposits", () => {
  test("each deposit with its amount (what was added, once credited), reference, number and status in words, opening its page", () => {
    const html = renderToStaticMarkup(createElement(DepositRows, { items: [deposit({}), deposit({ id: "d2", status: "credited", credited_amount: 450_000 }), deposit({ id: "d3", status: "rejected" })] }));
    expect(html).toContain('href="/account/wallet/deposits/d1"');
    expect(html).toContain("₦5,000");
    expect(html).toContain("₦4,500");
    expect(html).toContain("BCAB12CD34 · BD-000001");
    for (const words of ["Checking our bank", "Added to your wallet", "Not credited"]) expect(html).toContain(words);
  });

  test("the page asks for the filter and the page it shows, and offers older ones", async () => {
    const fetch = vi.fn(async () => reply({ object: "list", data: [deposit({ status: "awaiting_payment" })], has_more: true }));
    vi.stubGlobal("fetch", fetch);
    const html = renderToStaticMarkup(await DepositsPage({ searchParams: Promise.resolve({ show: "open" }) }));
    const url = String((fetch.mock.calls as unknown as Call[]).find(call => String(call[0]).includes("bank-deposits"))![0]);
    expect(url).toContain("/v1/store/wallet/bank-deposits?limit=20&show=open");
    expect(html).toContain("Waiting for your payment");
    expect(html).toMatch(/aria-current="page"[^>]*>In progress</);
    expect(html).toContain('href="/account/wallet/deposits?show=open&amp;after=d1"');
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
    expect(await startBankDeposit({}, form({ amount: "12abc", amount_currency: "NGN" }))).toMatchObject({ field: "amount" });
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
