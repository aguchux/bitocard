import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { formatCrypto } from "@bitocard/api-client/storefront";
import { setRequest } from "./request";
import type { StoreCryptoWallets } from "@bitocard/api-client/storefront";
import { canWithdraw, coinMark, hasP2pMoney, tradableAssets, withdrawableAssets } from "@/components/app/crypto";
import { activeTab, appTabs } from "@/components/app/tabs";

const redirect = vi.fn((url: string) => {
  throw new Error(`redirect:${url}`);
});
const revalidatePath = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (url: string) => redirect(url) }));
vi.mock("next/cache", () => ({ revalidatePath: (path: string) => revalidatePath(path) }));

const {
  addCashOutAccount,
  addTestCrypto,
  addWithdrawalAddress,
  cancelWithdrawal,
  cashOut,
  changeAd,
  confirmTrade,
  confirmWithdrawal,
  createWithdrawal,
  findBestPrice,
  postAd,
  removeCashOutAccount,
  removeWithdrawalAddress,
  repriceAd,
  reviewWithdrawal,
  simulateCashOut,
  takeAd,
} = await import("@/lib/crypto-actions");

type Call = [string, RequestInit & { headers: Record<string, string> }];
const form = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const calls = (fetch: ReturnType<typeof vi.fn>) => fetch.mock.calls as unknown as Call[];
const bodyOf = (call: Call) => JSON.parse(String(call[1].body));
const ad = "6b0a8f1e-5f6a-4f0e-9a51-0e4f3f0f1a11";
const nonce = "0d1c2b3a-4f5e-4d6c-8b7a-9f8e7d6c5b4a";
const keyOf = (call: Call) => call[1].headers["idempotency-key"];
const refused = (code: string, message: string, status = 409) => vi.fn(async () => reply({ error: { code, message } }, status));

beforeEach(() => {
  vi.stubEnv("API_URL", "http://api.test");
  setRequest({ host: "bitocard.com" }, { bc_customer: "bcc_session" });
  redirect.mockClear();
  revalidatePath.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("quick buy and sell", () => {
  test("asks for the best ad for the amount (minor units) and goes to the confirmation", async () => {
    const fetch = vi.fn(async () => reply({ object: "p2p_quote", side: "buy", price: 165000, ad: { id: ad } }));
    vi.stubGlobal("fetch", fetch);
    await expect(findBestPrice({}, form({ side: "buy", asset: "USDT", fiat: "82,500" }))).rejects.toThrow(`redirect:/account/crypto/confirm?ad=${ad}&price=165000&fiat=8250000`);
    expect(calls(fetch)[0][0]).toBe("http://api.test/v1/store/p2p/quote?asset=USDT&side=buy&fiat=8250000");
  });

  test("nobody to trade with, or no amount: says so on the form", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply({ error: { code: "no_matching_ad", message: "Nobody can take this amount right now.", param: "fiat" } }, 409)));
    expect(await findBestPrice({}, form({ side: "sell", asset: "BTC", fiat: "10" }))).toEqual({ error: "Nobody can take this amount right now.", field: "fiat" });
    expect(await findBestPrice({}, form({ side: "buy", asset: "BTC", fiat: "abc" }))).toEqual({ error: "Enter how much you want to trade.", field: "fiat" });
    expect(await takeAd({}, form({ ad_id: ad, price: "165000", fiat: "" }))).toEqual({ error: "Enter an amount.", field: "fiat" });
  });

  test("confirming sends exactly the trade shown (the price seen guards against changes) and opens its receipt", async () => {
    const fetch = vi.fn(async () => reply({ object: "p2p_trade", id: "t1" }, 201));
    vi.stubGlobal("fetch", fetch);
    await expect(confirmTrade({}, form({ ad_id: ad, price: "165000", fee_bps: "20", fiat: "8250000" }))).rejects.toThrow("redirect:/account/crypto/trades/t1?done=1");
    expect(bodyOf(calls(fetch)[0])).toEqual({ ad_id: ad, price: 165000, fee_bps: 20, fiat: 8250000 });
    await expect(confirmTrade({}, form({ ad_id: ad, price: "165000", fiat: "8250000" }))).rejects.toThrow("redirect:");
    expect(bodyOf(calls(fetch)[1])).toEqual({ ad_id: ad, price: 165000, fiat: 8250000 });
  });

  test("too little money points to the wallet; a changed price is shown", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply({ error: { code: "insufficient_funds", message: "Your NGN balance is too low." } }, 402)));
    expect(await confirmTrade({}, form({ ad_id: ad, price: "1", fiat: "1" }))).toMatchObject({ error: "Your NGN balance is too low.", field: "funds" });
    vi.stubGlobal("fetch", vi.fn(async () => reply({ error: { code: "price_changed", message: "The price of this ad changed." } }, 409)));
    expect(await confirmTrade({}, form({ ad_id: ad, price: "1", fiat: "1" }))).toMatchObject({ error: "The price of this ad changed." });
  });

  test("the form's nonce is the Idempotency-Key, so a double tap trades once; a refusal gives the form a fresh one", async () => {
    const fetch = vi.fn(async () => reply({ object: "p2p_trade", id: "t1" }, 201));
    vi.stubGlobal("fetch", fetch);
    const fields = { ad_id: ad, price: "165000", fiat: "8250000", nonce };
    await expect(confirmTrade({}, form(fields))).rejects.toThrow("redirect:");
    await expect(confirmTrade({}, form(fields))).rejects.toThrow("redirect:");
    expect(calls(fetch).map(keyOf)).toEqual([nonce, nonce]);

    const refusal = refused("price_changed", "The price of this ad changed.");
    vi.stubGlobal("fetch", refusal);
    const state = await confirmTrade({}, form(fields));
    expect(keyOf(calls(refusal)[0])).toBe(nonce);
    expect(state.nonce).toMatch(/^[0-9a-f-]{36}$/);
    expect(state.nonce).not.toBe(nonce);
  });

  test("a form without a usable nonce still gets a fresh key per request", async () => {
    const fetch = vi.fn(async () => reply({ object: "p2p_trade", id: "t1" }, 201));
    vi.stubGlobal("fetch", fetch);
    await expect(confirmTrade({}, form({ ad_id: ad, price: "1", fiat: "1", nonce: "bad key!" }))).rejects.toThrow("redirect:");
    await expect(confirmTrade({}, form({ ad_id: ad, price: "1", fiat: "1" }))).rejects.toThrow("redirect:");
    const [first, second] = calls(fetch).map(keyOf);
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(second).toMatch(/^[0-9a-f-]{36}$/);
    expect(first).not.toBe(second);
  });
});

describe("ads", () => {
  test("posting converts the price and limits to minor units and keeps the amount as typed", async () => {
    const fetch = vi.fn(async () => reply({ object: "p2p_ad", id: ad }, 201));
    vi.stubGlobal("fetch", fetch);
    await expect(postAd({}, form({ side: "sell", asset: "USDT", price: "1,650.50", amount: "100.5", min_fiat: "1,000", max_fiat: "500000", terms: "" }))).rejects.toThrow("redirect:/account/crypto/ads?posted=1");
    expect(bodyOf(calls(fetch)[0])).toEqual({ side: "sell", asset: "USDT", price: 165050, amount: "100.5", min_fiat: 100000, max_fiat: 50000000 });
    expect(await postAd({}, form({ side: "buy", asset: "USDT", price: "1650", amount: "-1", min_fiat: "1", max_fiat: "2" }))).toEqual({ error: "Enter how much to trade.", field: "amount" });
  });

  test("posting a USD buy ad sends the selected wallet currency", async () => {
    const fetch = vi.fn(async () => reply({ object: "p2p_ad", id: ad }, 201));
    vi.stubGlobal("fetch", fetch);
    await expect(postAd({}, form({ side: "buy", asset: "ETH", currency: "USD", price: "2,000", amount: "1.5", min_fiat: "50", max_fiat: "3000" }))).rejects.toThrow("redirect:/account/crypto/ads?posted=1");
    expect(bodyOf(calls(fetch)[0])).toMatchObject({ side: "buy", asset: "ETH", currency: "USD", price: 200000, amount: "1.5" });
  });

  test("pause, resume, close and a new price", async () => {
    const fetch = vi.fn(async () => reply({ object: "p2p_ad", id: ad }));
    vi.stubGlobal("fetch", fetch);
    expect(await changeAd({}, form({ id: ad, op: "pause" }))).toEqual({});
    expect(await changeAd({}, form({ id: ad, op: "cancel" }))).toEqual({});
    expect(calls(fetch).map(call => [call[1].method, call[0]])).toEqual([
      ["PATCH", `http://api.test/v1/store/p2p/ads/${ad}`],
      ["POST", `http://api.test/v1/store/p2p/ads/${ad}/cancel`],
    ]);
    expect(bodyOf(calls(fetch)[0])).toEqual({ status: "paused" });
    expect((await repriceAd({}, form({ id: ad, price: "1700" }))).notice).toBe("Price updated.");
    expect(bodyOf(calls(fetch)[2])).toEqual({ price: 170000 });
  });

  test("a refused pause or close says why", async () => {
    vi.stubGlobal("fetch", refused("ad_closed", "This ad is already closed."));
    expect(await changeAd({}, form({ id: ad, op: "cancel" }))).toEqual({ error: "This ad is already closed." });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  test("sandbox test crypto", async () => {
    const fetch = vi.fn(async () => reply({ object: "crypto_balance" }, 201));
    vi.stubGlobal("fetch", fetch);
    expect((await addTestCrypto({}, form({ asset: "BTC", amount: "0.5" }))).notice).toBe("Added 0.5 test BTC.");
    expect(bodyOf(calls(fetch)[0])).toEqual({ asset: "BTC", amount: "0.5" });
  });
});

describe("display", () => {
  test("crypto amounts drop trailing zeros, keep two places for stablecoins and group thousands", () => {
    expect(formatCrypto("49.900000", "USDT")).toBe("49.90 USDT");
    expect(formatCrypto("0.00019960", "BTC")).toBe("0.0001996 BTC");
    expect(formatCrypto("12500.000000")).toBe("12,500");
  });

  test("Crypto is its own tab, with its pages", () => {
    expect(appTabs.map(tab => tab.label)).toContain("Crypto");
    expect(activeTab("/account/crypto")).toBe("/account/crypto");
    expect(activeTab("/account/crypto/trades/abc")).toBe("/account/crypto");
  });
});

describe("withdrawals", () => {
  const address = "3f0c2a1e-5f6a-4f0e-9a51-0e4f3f0f1a22";

  test("saving an address sends the chain, address and name; problems point at the field", async () => {
    const fetch = vi.fn(async () => reply({ object: "crypto_withdrawal_address", id: address, label: "Cold", usable_from: "2026-10-14T10:00:00.000Z" }, 201));
    vi.stubGlobal("fetch", fetch);
    const saved = await addWithdrawalAddress({}, form({ chain: "ETHEREUM", address: " 0xabc ", label: "Cold" }));
    expect(saved.notice).toMatch(/^Saved\. You can send to "Cold" from /);
    expect(bodyOf(calls(fetch)[0])).toEqual({ chain: "ETHEREUM", address: "0xabc", label: "Cold" });
    expect(await addWithdrawalAddress({}, form({ chain: "ETHEREUM", address: "", label: "Cold" }))).toEqual({ error: "Paste the address.", field: "address" });
    vi.stubGlobal("fetch", vi.fn(async () => reply({ error: { code: "address_invalid", message: "This is not a valid Ethereum address.", param: "address" } }, 400)));
    expect(await addWithdrawalAddress({}, form({ chain: "ETHEREUM", address: "0xabc", label: "Cold" }))).toEqual({ error: "This is not a valid Ethereum address.", field: "address" });
  });

  test("reviewing previews first and goes to the confirmation; confirming asks for it and opens its page", async () => {
    const fetch = vi.fn(async () => reply({ object: "crypto_withdrawal_preview" }));
    vi.stubGlobal("fetch", fetch);
    await expect(reviewWithdrawal({}, form({ asset: "USDT", chain: "TRON", address_id: address, amount: "1,000.5" }))).rejects.toThrow(
      `redirect:/account/crypto/withdraw/confirm?asset=USDT&chain=TRON&address=${address}&amount=1000.5`,
    );
    expect(bodyOf(calls(fetch)[0])).toEqual({ asset: "USDT", chain: "TRON", address_id: address, amount: "1000.5", preview: true });
    expect(await reviewWithdrawal({}, form({ asset: "USDT", chain: "TRON", address_id: address, amount: "0" }))).toEqual({ error: "Enter how much to send.", field: "amount" });

    const created = vi.fn(async () => reply({ object: "crypto_withdrawal", id: "w1", status: "awaiting_code" }, 201));
    vi.stubGlobal("fetch", created);
    await expect(createWithdrawal({}, form({ asset: "USDT", chain: "TRON", address_id: address, amount: "1000.5" }))).rejects.toThrow("redirect:/account/crypto/withdrawals/w1");
    expect(bodyOf(calls(created)[0])).toEqual({ asset: "USDT", chain: "TRON", address_id: address, amount: "1000.5" });
  });

  test("the emailed code confirms it; cancelling posts to the withdrawal", async () => {
    const fetch = vi.fn(async () => reply({ object: "crypto_withdrawal", id: "w1", status: "review" }));
    vi.stubGlobal("fetch", fetch);
    expect(await confirmWithdrawal({}, form({ id: "w1", code: "12 34 56" }))).toEqual({ notice: "Confirmed. BitoCard checks this withdrawal before it is sent." });
    expect(calls(fetch)[0][0]).toBe("http://api.test/v1/store/crypto/withdrawals/w1/confirm");
    expect(bodyOf(calls(fetch)[0])).toEqual({ code: "123456" });
    expect(await confirmWithdrawal({}, form({ id: "w1", code: "12" }))).toEqual({ error: "Enter the 6-digit code we emailed you.", field: "code" });
    expect(await cancelWithdrawal({}, form({ id: "w1" }))).toEqual({});
    expect(calls(fetch).at(-1)![0]).toBe("http://api.test/v1/store/crypto/withdrawals/w1/cancel");
  });

  test("a refused cancel or address removal says why", async () => {
    vi.stubGlobal("fetch", refused("withdrawal_not_cancellable", "This withdrawal is already on its way."));
    expect(await cancelWithdrawal({}, form({ id: "w1" }))).toEqual({ error: "This withdrawal is already on its way." });
    vi.stubGlobal("fetch", refused("resource_missing", "No such address.", 404));
    expect(await removeWithdrawalAddress({}, form({ id: address }))).toEqual({ error: "No such address." });
    const removed = vi.fn(async () => reply({ object: "crypto_withdrawal_address", id: address, deleted: true }));
    vi.stubGlobal("fetch", removed);
    expect(await removeWithdrawalAddress({}, form({ id: address }))).toEqual({});
    expect(calls(removed)[0][1].method).toBe("DELETE");
  });

  test("asking for a withdrawal sends the form's nonce as its Idempotency-Key; a refusal gives a fresh one", async () => {
    const created = vi.fn(async () => reply({ object: "crypto_withdrawal", id: "w1", status: "awaiting_code" }, 201));
    vi.stubGlobal("fetch", created);
    const fields = { asset: "USDT", chain: "TRON", address_id: address, amount: "10", nonce };
    await expect(createWithdrawal({}, form(fields))).rejects.toThrow("redirect:/account/crypto/withdrawals/w1");
    expect(keyOf(calls(created)[0])).toBe(nonce);
    vi.stubGlobal("fetch", refused("withdrawal_limit", "You can send up to 0 USDT more today.", 400));
    const state = await createWithdrawal({}, form(fields));
    expect(state).toMatchObject({ error: "You can send up to 0 USDT more today." });
    expect(state.nonce).not.toBe(nonce);
  });
});

describe("cashing out P2P money", () => {
  const account = "4a0c2a1e-5f6a-4f0e-9a51-0e4f3f0f1a33";

  test("adding a bank account sends the bank and the digits only; the API's reason points at the field", async () => {
    const fetch = vi.fn(async () => reply({ object: "customer_bank_account", id: account, bank_name: "Sandbox Bank", account_number_last4: "6789", account_name: "ADA TRADER" }, 201));
    vi.stubGlobal("fetch", fetch);
    expect(await addCashOutAccount({}, form({ bank_code: "SBX001", account_number: "0123 456 789" }))).toEqual({ notice: "Added Sandbox Bank ending 6789 (ADA TRADER)." });
    expect(bodyOf(calls(fetch)[0])).toEqual({ bank_code: "SBX001", account_number: "0123456789" });
    expect(await addCashOutAccount({}, form({ bank_code: "", account_number: "0123456789" }))).toEqual({ error: "Choose your bank.", field: "bank_code" });
    vi.stubGlobal("fetch", vi.fn(async () => reply({ error: { code: "account_name_mismatch", message: "This account is in the name of SOMEONE ELSE.", param: "account_number" } }, 400)));
    expect(await addCashOutAccount({}, form({ bank_code: "SBX001", account_number: "0123456789" }))).toEqual({ error: "This account is in the name of SOMEONE ELSE.", field: "account_number" });
  });

  test("paying out sends the amount in minor units; a refusal is shown", async () => {
    const fetch = vi.fn(async () => reply({ object: "customer_payout", id: "p1", status: "processing" }, 201));
    vi.stubGlobal("fetch", fetch);
    expect(await cashOut({}, form({ bank_account_id: account, amount: "15,000.50" }))).toMatchObject({ notice: "On its way to your bank." });
    expect(bodyOf(calls(fetch)[0])).toEqual({ amount: 1500050, bank_account_id: account });
    vi.stubGlobal("fetch", vi.fn(async () => reply({ error: { code: "insufficient_funds", message: "You can pay out up to ₦0.00 now.", param: "amount" } }, 402)));
    expect(await cashOut({}, form({ bank_account_id: account, amount: "15000" }))).toMatchObject({ error: "You can pay out up to ₦0.00 now.", field: "amount" });
  });

  test("a double tap pays out once (the form's nonce); after a payout the form gets a fresh nonce for the next one", async () => {
    const fetch = vi.fn(async () => reply({ object: "customer_payout", id: "p1", status: "processing" }, 201));
    vi.stubGlobal("fetch", fetch);
    const fields = { bank_account_id: account, amount: "100", nonce };
    const first = await cashOut({}, form(fields));
    await cashOut({}, form(fields));
    expect(calls(fetch).map(keyOf)).toEqual([nonce, nonce]);
    expect(first.nonce).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.nonce).not.toBe(nonce);
  });

  test("removing an account and the sandbox's simulated payouts say why when refused", async () => {
    vi.stubGlobal("fetch", refused("resource_missing", "No such bank account.", 404));
    expect(await removeCashOutAccount({}, form({ id: account }))).toEqual({ error: "No such bank account." });
    vi.stubGlobal("fetch", refused("payout_settled", "This payout is already settled."));
    expect(await simulateCashOut({}, form({ id: "p1", outcome: "failed" }))).toEqual({ error: "This payout is already settled." });
    const settled = vi.fn(async () => reply({ object: "customer_payout", id: "p1", status: "failed" }));
    vi.stubGlobal("fetch", settled);
    expect(await simulateCashOut({}, form({ id: "p1", outcome: "failed" }))).toEqual({});
    expect(bodyOf(calls(settled)[0])).toEqual({ outcome: "failed" });
    expect(revalidatePath).toHaveBeenCalledWith("/account/crypto/cash-out");
  });
});
describe("what the crypto pages offer", () => {
  const coin = (asset: string, available: string, enabled = true) => ({ object: "crypto_balance" as const, asset, name: asset, decimals: 6, enabled, available, locked: "0", frozen: "0", withdrawing: "0", total: available });
  const wallets = (over: Partial<StoreCryptoWallets>): StoreCryptoWallets => ({
    object: "crypto_wallets",
    mode: "live",
    country: "NG",
    currency: "NGN",
    enabled: true,
    p2p_enabled: true,
    global_enabled: false,
    verified: true,
    declaration: { version: "2026-10-27", declared: true },
    frozen: false,
    assets: [coin("USDT", "0"), coin("BTC", "0.5"), coin("BNB", "1", false)],
    cash: { currency: "NGN", proceeds: 0, wallet: 0, locked: 0, paying_out: 0 },
    other_cash: [],
    ...over,
  });

  test("a coin switched off is withdrawn, never traded or deposited", () => {
    expect(tradableAssets(wallets({}))).toEqual(["USDT", "BTC"]);
    expect(withdrawableAssets(wallets({}))).toEqual(["USDT", "BTC", "BNB"]);
  });

  test("with crypto switched off, coins held can still be withdrawn and P2P money cashed out", () => {
    const closed = wallets({ enabled: false, p2p_enabled: false, cash: { currency: "NGN", proceeds: 0, wallet: 0, locked: 0, paying_out: 5000 } });
    expect(tradableAssets(closed)).toEqual([]);
    expect(withdrawableAssets(closed)).toEqual(["BTC", "BNB"]);
    expect(canWithdraw(closed)).toBe(true);
    expect(hasP2pMoney(closed)).toBe(true);
  });

  test("every coin has its own colour and a one-character mark, unknown ones a fallback", () => {
    const codes = ["USDT", "USDC", "BTC", "ETH", "BNB", "POL", "TRX", "LTC", "DOGE"];
    for (const code of codes) expect([...coinMark(code).glyph]).toHaveLength(1);
    expect(new Set(codes.map(code => coinMark(code).colour)).size).toBe(codes.length);
    expect(coinMark("BTC").glyph).toBe("₿");
    expect(coinMark("SOL")).toEqual({ colour: "bg-slate-500 text-white", glyph: "S" });
  });

  test("withdrawing needs a verified, unfrozen account holding something", () => {
    expect(canWithdraw(wallets({ verified: false }))).toBe(false);
    expect(canWithdraw(wallets({ frozen: true }))).toBe(false);
    expect(canWithdraw(wallets({ assets: [coin("USDT", "0")] }))).toBe(false);
    expect(hasP2pMoney(wallets({}))).toBe(false);
  });
});
