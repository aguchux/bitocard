"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { StoreCryptoWithdrawal, StoreCustomerBankAccount, StoreCustomerPayout, StoreP2pAd, StoreP2pProfile, StoreP2pQuote, StoreP2pTrade, StoreWithdrawalAddress } from "@bitocard/api-client/storefront";
import type { FormState } from "@/lib/account-actions";
import { customerApi } from "@/lib/customer";
import { exchangeHref } from "@/lib/exchange";

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
const nonceOf = (form: FormData) => text(form, "nonce") || undefined;
const fresh = (state: FormState): NonceFormState => ({ ...state, nonce: randomUUID() });

function signInFirst(status: number, path: string) {
  if (status === 401) redirect(`/signin?next=${encodeURIComponent(path)}`);
}

/** Sandbox stores only: test crypto into the customer's wallet. */
/** The crypto declaration (not a US or UK citizen or resident), made once per version before trading. */
export async function declareCrypto(form: FormData): Promise<void> {
  if (form.get("confirm") !== "yes") return;
  await customerApi("POST", "/v1/store/crypto/declaration", { version: text(form, "version") });
  revalidatePath("/account/crypto", "layout");
}

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

/** Takes an ad from the market list: the amount typed, then the confirmation. */
export async function takeAd(_state: FormState, form: FormData): Promise<FormState> {
  const fiat = toMinor(text(form, "fiat"));
  if (!fiat) return { error: "Enter an amount.", field: "fiat" };
  redirect(`/account/crypto/confirm?${new URLSearchParams({ ad: text(form, "ad_id"), price: text(form, "price"), fiat: String(fiat) }).toString()}`);
}

/** The trade the customer confirmed: settled at once from their wallets, then its receipt. */
export async function confirmTrade(_state: NonceFormState, form: FormData): Promise<NonceFormState> {
  const fiat = Number(text(form, "fiat"));
  // The fee rate the customer was shown: a changed fee is refused, like a changed price.
  const feeBps = text(form, "fee_bps");
  const body = { ad_id: text(form, "ad_id"), price: Number(text(form, "price")), ...(feeBps ? { fee_bps: Number(feeBps) } : {}), fiat };
  const result = await customerApi<StoreP2pTrade>("POST", "/v1/store/p2p/trades", body, { idempotencyKey: nonceOf(form) });
  if (!result.ok) {
    signInFirst(result.status, "/account/crypto");
    if (result.code === "insufficient_funds") return fresh({ error: result.message, field: "funds" });
    return fresh({ error: result.message });
  }
  revalidatePath("/account/crypto", "layout");
  redirect(`/account/crypto/trades/${result.data.id}?done=1`);
}

/** Posts an ad: price and limits in the customer's currency, the amount in the asset. */
export async function postAd(_state: FormState, form: FormData): Promise<FormState> {
  const price = toMinor(text(form, "price"));
  const min = toMinor(text(form, "min_fiat"));
  const max = toMinor(text(form, "max_fiat"));
  const amount = cryptoAmount(text(form, "amount"));
  if (!price) return { error: "Enter your price.", field: "price" };
  if (!amount) return { error: "Enter how much to trade.", field: "amount" };
  if (!min) return { error: "Enter the smallest trade you take.", field: "min_fiat" };
  if (!max) return { error: "Enter the largest trade you take.", field: "max_fiat" };
  const result = await customerApi<StoreP2pAd>("POST", "/v1/store/p2p/ads", {
    side: text(form, "side") === "buy" ? "buy" : "sell",
    asset: text(form, "asset"),
    ...(text(form, "currency") ? { currency: text(form, "currency") } : {}),
    price,
    amount,
    min_fiat: min,
    max_fiat: max,
    terms: text(form, "terms") || undefined,
  });
  if (!result.ok) {
    signInFirst(result.status, "/account/crypto/ads");
    return { error: result.message, field: result.param };
  }
  revalidatePath("/account/crypto", "layout");
  redirect("/account/crypto/ads?posted=1");
}

/** Pauses, resumes or closes one of the customer's ads (closing gives back what it locks). */
export async function changeAd(_state: FormState, form: FormData): Promise<FormState> {
  const id = encodeURIComponent(text(form, "id"));
  const op = text(form, "op");
  const result = op === "cancel" ? await customerApi("POST", `/v1/store/p2p/ads/${id}/cancel`) : await customerApi("PATCH", `/v1/store/p2p/ads/${id}`, { status: op === "resume" ? "active" : "paused" });
  if (!result.ok) {
    signInFirst(result.status, "/account/crypto/ads");
    return { error: result.message };
  }
  revalidatePath("/account/crypto/ads");
  revalidatePath("/account/crypto", "layout");
  return {};
}

/** Changes an ad's price (a buy ad locks more, or gives back what it no longer needs). */
export async function repriceAd(_state: FormState, form: FormData): Promise<FormState> {
  const price = toMinor(text(form, "price"));
  if (!price) return { error: "Enter your new price.", field: "price" };
  const result = await customerApi("PATCH", `/v1/store/p2p/ads/${encodeURIComponent(text(form, "id"))}`, { price });
  if (!result.ok) return { error: result.message, field: "price" };
  revalidatePath("/account/crypto/ads");
  return { notice: "Price updated." };
}

/** Chooses the nickname others see on the market, once. */
export async function chooseNickname(_state: FormState, form: FormData): Promise<FormState> {
  const result = await customerApi<StoreP2pProfile>("PUT", "/v1/store/p2p/profile", { nickname: text(form, "nickname") });
  if (!result.ok) return { error: result.message, field: "nickname" };
  revalidatePath("/account/crypto", "layout");
  return { notice: `You trade as ${result.data.nickname}.` };
}

// -- Withdrawals ----------------------------------------------------------------------------------------------------

/** Saves an address to withdraw to (usable 24 hours later; the customer is emailed). */
export async function addWithdrawalAddress(_state: FormState, form: FormData): Promise<FormState> {
  const address = text(form, "address");
  const label = text(form, "label");
  if (!address) return { error: "Paste the address.", field: "address" };
  if (!label) return { error: "Give the address a name you will recognise.", field: "label" };
  const result = await customerApi<StoreWithdrawalAddress>("POST", "/v1/store/crypto/withdrawal-addresses", { chain: text(form, "chain"), address, label });
  if (!result.ok) {
    signInFirst(result.status, "/account/crypto/withdraw");
    return { error: result.message, field: result.param === "address" || result.param === "label" ? result.param : null };
  }
  revalidatePath("/account/crypto/withdraw");
  return { notice: `Saved. You can send to "${result.data.label}" from ${new Date(result.data.usable_from).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}.` };
}

export async function removeWithdrawalAddress(_state: FormState, form: FormData): Promise<FormState> {
  const result = await customerApi("DELETE", `/v1/store/crypto/withdrawal-addresses/${encodeURIComponent(text(form, "id"))}`);
  if (!result.ok) {
    signInFirst(result.status, "/account/crypto/withdraw");
    return { error: result.message };
  }
  revalidatePath("/account/crypto/withdraw");
  return {};
}

/** Checks the amount and goes to the confirmation, where the customer sees the fee and total before anything moves. */
export async function reviewWithdrawal(_state: FormState, form: FormData): Promise<FormState> {
  const amount = cryptoAmount(text(form, "amount"));
  const addressId = text(form, "address_id");
  if (!addressId) return { error: "Choose where to send it.", field: "address_id" };
  if (!amount) return { error: "Enter how much to send.", field: "amount" };
  const body = { asset: text(form, "asset"), chain: text(form, "chain"), address_id: addressId, amount, preview: true };
  const result = await customerApi("POST", "/v1/store/crypto/withdrawals", body);
  if (!result.ok) {
    signInFirst(result.status, "/account/crypto/withdraw");
    return { error: result.message, field: result.param === "amount" ? "amount" : null };
  }
  redirect(`/account/crypto/withdraw/confirm?${new URLSearchParams({ asset: body.asset, chain: body.chain, address: addressId, amount }).toString()}`);
}

/** Asks for the withdrawal: its amount and fee leave the wallet, and a code is emailed to confirm it. */
export async function createWithdrawal(_state: NonceFormState, form: FormData): Promise<NonceFormState> {
  const body = { asset: text(form, "asset"), chain: text(form, "chain"), address_id: text(form, "address_id"), amount: text(form, "amount") };
  const result = await customerApi<StoreCryptoWithdrawal>("POST", "/v1/store/crypto/withdrawals", body, { idempotencyKey: nonceOf(form) });
  if (!result.ok) {
    signInFirst(result.status, "/account/crypto/withdraw");
    return fresh({ error: result.message });
  }
  revalidatePath("/account/crypto", "layout");
  redirect(`/account/crypto/withdrawals/${result.data.id}`);
}

/** The emailed code confirms the withdrawal. */
export async function confirmWithdrawal(_state: FormState, form: FormData): Promise<FormState> {
  const id = text(form, "id");
  const code = text(form, "code").replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) return { error: "Enter the 6-digit code we emailed you.", field: "code" };
  const result = await customerApi<StoreCryptoWithdrawal>("POST", `/v1/store/crypto/withdrawals/${encodeURIComponent(id)}/confirm`, { code });
  if (!result.ok) return { error: result.message, field: "code" };
  revalidatePath(`/account/crypto/withdrawals/${id}`);
  return { notice: result.data.status === "review" ? "Confirmed. BitoCard checks this withdrawal before it is sent." : "Confirmed. Your withdrawal is on its way." };
}

export async function resendWithdrawalCode(_state: FormState, form: FormData): Promise<FormState> {
  const result = await customerApi("POST", `/v1/store/crypto/withdrawals/${encodeURIComponent(text(form, "id"))}/resend-code`);
  if (!result.ok) return { error: result.message };
  return { notice: "A new code is on its way to your email." };
}

export async function cancelWithdrawal(_state: FormState, form: FormData): Promise<FormState> {
  const id = text(form, "id");
  const result = await customerApi("POST", `/v1/store/crypto/withdrawals/${encodeURIComponent(id)}/cancel`);
  if (!result.ok) {
    signInFirst(result.status, `/account/crypto/withdrawals/${id}`);
    return { error: result.message };
  }
  revalidatePath(`/account/crypto/withdrawals/${id}`);
  revalidatePath("/account/crypto", "layout");
  return {};
}

// -- Paying P2P money out to a bank ---------------------------------------------------------------------------------

/** Adds a bank account for P2P money (in the customer's verified name; usable after 24 hours on live stores). */
export async function addCashOutAccount(_state: FormState, form: FormData): Promise<FormState> {
  const bankCode = text(form, "bank_code");
  const accountNumber = text(form, "account_number").replace(/\s/g, "");
  if (!bankCode) return { error: "Choose your bank.", field: "bank_code" };
  if (!/^\d{6,20}$/.test(accountNumber)) return { error: "Enter your account number, digits only.", field: "account_number" };
  const result = await customerApi<StoreCustomerBankAccount>("POST", "/v1/store/crypto/cash/bank-accounts", { bank_code: bankCode, account_number: accountNumber });
  if (!result.ok) {
    signInFirst(result.status, "/account/crypto/cash-out");
    return { error: result.message, field: result.param === "account_number" || result.param === "bank_code" ? result.param : null };
  }
  revalidatePath("/account/crypto/cash-out");
  // The same accounts are BitoCard Shop's payout accounts for Safe pay sales (the Shop tab's Safe pay page adds them too).
  revalidatePath("/shop/safe-pay");
  return { notice: `Added ${result.data.bank_name} ending ${result.data.account_number_last4} (${result.data.account_name}).` };
}

export async function removeCashOutAccount(_state: FormState, form: FormData): Promise<FormState> {
  const result = await customerApi("DELETE", `/v1/store/crypto/cash/bank-accounts/${encodeURIComponent(text(form, "id"))}`);
  if (!result.ok) {
    signInFirst(result.status, "/account/crypto/cash-out");
    return { error: result.message };
  }
  revalidatePath("/account/crypto/cash-out");
  return {};
}

/** Pays P2P money out to one of the customer's bank accounts (the amount typed in their currency). */
export async function cashOut(_state: NonceFormState, form: FormData): Promise<NonceFormState> {
  const amount = toMinor(text(form, "amount"));
  const account = text(form, "bank_account_id");
  if (!account) return { error: "Choose the account to pay into.", field: "bank_account_id" };
  if (!amount) return { error: "Enter how much to pay out.", field: "amount" };
  const result = await customerApi<StoreCustomerPayout>("POST", "/v1/store/crypto/cash/payouts", { amount, bank_account_id: account }, { idempotencyKey: nonceOf(form) });
  if (!result.ok) {
    signInFirst(result.status, "/account/crypto/cash-out");
    return fresh({ error: result.message, field: result.param === "amount" ? "amount" : null });
  }
  revalidatePath("/account/crypto/cash-out");
  revalidatePath("/account/crypto", "layout");
  // A fresh nonce: another payout from the same form is a new request.
  return fresh({ notice: result.data.status === "failed" ? `The bank refused it: ${result.data.failure_reason ?? "try another account"}. The money is back in your balance.` : "On its way to your bank." });
}

/** Sandbox stores only: settles a test payout as paid or failed. */
export async function simulateCashOut(_state: FormState, form: FormData): Promise<FormState> {
  const result = await customerApi("POST", `/v1/store/crypto/cash/payouts/${encodeURIComponent(text(form, "id"))}/simulate`, { outcome: text(form, "outcome") === "failed" ? "failed" : "paid" });
  if (!result.ok) return { error: result.message };
  revalidatePath("/account/crypto/cash-out");
  return {};
}

/** The best price on the P2P market for a coin and side right now (fiat minor units per whole coin), or null with no ad. */
export async function bestP2pPrice(asset: string, side: "buy" | "sell"): Promise<number | null> {
  if (!/^[A-Z0-9]{2,10}$/.test(asset)) return null;
  const result = await customerApi<{ data: StoreP2pAd[] }>("GET", `/v1/store/p2p/market?${new URLSearchParams({ asset, side: side === "sell" ? "sell" : "buy", limit: "1" }).toString()}`);
  return result.ok ? (result.data.data[0]?.price ?? null) : null;
}
