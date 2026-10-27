"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { StoreP2pAd, StoreP2pQuote } from "@bitocard/api-client/storefront";
import type { FormState } from "@/lib/account-actions";
import { customerApi } from "@/lib/customer";
import { exchangeHref } from "@/lib/exchange";
import { moneyActions } from "@bitocard/crypto-ui/money-actions";
import { tradeActions } from "@bitocard/crypto-ui/trade-actions";

const text = (form: FormData, name: string) => String(form.get(name) ?? "").trim();

/** Fiat typed by people ("1,650.50") in minor units, or null when it is not a positive amount. */
function toMinor(value: string) {
  const amount = Math.round(Number(value.replace(/[,\s]/g, "")) * 100);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

/** A crypto amount as typed ("0.5", "1,000"), or null. The API checks its decimal places. */
function cryptoAmount(value: string) {
  const amount = value.replace(/[,\s]/g, "");
  return /^\d+(\.\d+)?$/.test(amount) && Number(amount) > 0 ? amount : null;
}

/**
 * A form that moves money carries a nonce made when it was shown, sent as the request's Idempotency-Key, so a double
 * submit acts once. Every answer that leaves the form on screen carries a fresh one: the API keeps client errors for
 * a key, so trying again after fixing something must be a new request.
 */
export type NonceFormState = FormState & { nonce?: string };

function signInFirst(status: number, path: string) {
  if (status === 401) redirect(`/signin?next=${encodeURIComponent(path)}`);
}

/** Sandbox stores only: test crypto into the customer's wallet. */
export async function addTestCrypto(_state: FormState, form: FormData): Promise<FormState> {
  const amount = cryptoAmount(text(form, "amount"));
  if (!amount) return { error: "Enter an amount above zero.", field: "amount" };
  const result = await customerApi("POST", "/v1/store/crypto/test-deposits", { asset: text(form, "asset"), amount });
  if (!result.ok) return { error: result.message, field: result.param };
  revalidatePath("/account/crypto", "layout");
  return { notice: `Added ${amount} test ${text(form, "asset")}.` };
}

/**
 * Quick buy or sell: from BitoCard's reserve (`source=reserve`) it opens the instant exchange with the coin, side and
 * amount filled in, where the customer reviews a held price; from traders it finds the best ad for the amount (fiat)
 * and goes to the confirmation, where the customer sees exactly what they get before anything moves.
 */
export async function findBestPrice(_state: FormState, form: FormData): Promise<FormState> {
  const fiat = toMinor(text(form, "fiat"));
  if (!fiat) return { error: "Enter how much you want to trade.", field: "fiat" };
  const side = text(form, "side") === "sell" ? "sell" : "buy";
  const asset = text(form, "asset");
  if (text(form, "source") === "reserve") redirect(exchangeHref({ asset, side, fiat }));
  const result = await customerApi<StoreP2pQuote>("GET", `/v1/store/p2p/quote?${new URLSearchParams({ asset, side, fiat: String(fiat) }).toString()}`);
  if (!result.ok) {
    signInFirst(result.status, "/account/crypto");
    return { error: result.message, field: result.param === "fiat" ? "fiat" : null };
  }
  redirect(`/account/crypto/confirm?${new URLSearchParams({ ad: result.data.ad!.id, price: String(result.data.price), fiat: String(fiat) }).toString()}`);
}

/**
 * The trading actions: the work is `@bitocard/crypto-ui`'s (`tradeActions`, shared with BitoCard Crypto), over this
 * store's customer session and on the Crypto tab's pages.
 */
const trade = tradeActions({
  api: customerApi,
  paths: {
    confirm: "/account/crypto/confirm",
    trade: id => `/account/crypto/trades/${id}?done=1`,
    ads: "/account/crypto/ads",
    signIn: next => `/signin?next=${encodeURIComponent(next)}`,
    refresh: ["/account/crypto"],
  },
  redirect,
  revalidate: revalidatePath,
});

/** The crypto declaration (not a US or UK citizen or resident), made once per version before trading. */
export async function declareCrypto(form: FormData): Promise<void> {
  return trade.declare(form);
}

/** Takes an ad from the market list: the amount typed, then the confirmation. */
export async function takeAd(_state: FormState, form: FormData): Promise<FormState> {
  return trade.takeAd(form);
}

/** The trade the customer confirmed: settled at once from their wallets, then its receipt. */
export async function confirmTrade(_state: NonceFormState, form: FormData): Promise<NonceFormState> {
  return trade.confirmTrade(form);
}

/** Posts an ad: price and limits in the market's currency, the amount in the coin. */
export async function postAd(_state: FormState, form: FormData): Promise<FormState> {
  return trade.postAd(form);
}

/** Pauses, resumes or closes one of the customer's ads (closing gives back what it locks). */
export async function changeAd(_state: FormState, form: FormData): Promise<FormState> {
  return trade.changeAd(form);
}

/** Changes an ad's price (a buy ad locks more, or gives back what it no longer needs). */
export async function repriceAd(_state: FormState, form: FormData): Promise<FormState> {
  return trade.repriceAd(form);
}

/** Chooses the nickname others see on the market, once. */
export async function chooseNickname(_state: FormState, form: FormData): Promise<FormState> {
  return trade.chooseNickname(form);
}

// -- Withdrawals and cashing out (`@bitocard/crypto-ui`, shared with BitoCard Crypto) -----------------------------------

const money = moneyActions({
  api: customerApi,
  paths: {
    withdraw: "/account/crypto/withdraw",
    withdrawConfirm: "/account/crypto/withdraw/confirm",
    withdrawal: id => `/account/crypto/withdrawals/${id}`,
    cashOut: "/account/crypto/cash-out",
    signIn: next => `/signin?next=${encodeURIComponent(next)}`,
    refresh: ["/account/crypto"],
    // The same accounts are BitoCard Shop's payout accounts for Safe pay sales (the Shop tab's Safe pay page adds them too).
    bankAccountsAlso: ["/shop/safe-pay"],
  },
  redirect,
  revalidate: revalidatePath,
});

export async function addWithdrawalAddress(_state: FormState, form: FormData): Promise<FormState> {
  return money.addWithdrawalAddress(form);
}
export async function removeWithdrawalAddress(_state: FormState, form: FormData): Promise<FormState> {
  return money.removeWithdrawalAddress(form);
}
export async function reviewWithdrawal(_state: FormState, form: FormData): Promise<FormState> {
  return money.reviewWithdrawal(form);
}
export async function createWithdrawal(_state: NonceFormState, form: FormData): Promise<NonceFormState> {
  return money.createWithdrawal(form);
}
export async function confirmWithdrawal(_state: FormState, form: FormData): Promise<FormState> {
  return money.confirmWithdrawal(form);
}
export async function resendWithdrawalCode(_state: FormState, form: FormData): Promise<FormState> {
  return money.resendWithdrawalCode(form);
}
export async function cancelWithdrawal(_state: FormState, form: FormData): Promise<FormState> {
  return money.cancelWithdrawal(form);
}
export async function addCashOutAccount(_state: FormState, form: FormData): Promise<FormState> {
  return money.addCashOutAccount(form);
}
export async function removeCashOutAccount(_state: FormState, form: FormData): Promise<FormState> {
  return money.removeCashOutAccount(form);
}
export async function cashOut(_state: NonceFormState, form: FormData): Promise<NonceFormState> {
  return money.cashOut(form);
}
export async function simulateCashOut(_state: FormState, form: FormData): Promise<FormState> {
  return money.simulateCashOut(form);
}

/** The best price on the P2P market for a coin and side right now (fiat minor units per whole coin), or null with no ad. */
export async function bestP2pPrice(asset: string, side: "buy" | "sell"): Promise<number | null> {
  if (!/^[A-Z0-9]{2,10}$/.test(asset)) return null;
  const result = await customerApi<{ data: StoreP2pAd[] }>("GET", `/v1/store/p2p/market?${new URLSearchParams({ asset, side: side === "sell" ? "sell" : "buy", limit: "1" }).toString()}`);
  return result.ok ? (result.data.data[0]?.price ?? null) : null;
}
