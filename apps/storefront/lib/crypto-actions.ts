"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { StoreCryptoWithdrawal, StoreP2pAd, StoreP2pProfile, StoreP2pQuote, StoreP2pTrade, StoreWithdrawalAddress } from "@bitocard/api-client/storefront";
import type { FormState } from "@/lib/account-actions";
import { customerApi } from "@/lib/customer";

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

function signInFirst(status: number, path: string) {
  if (status === 401) redirect(`/signin?next=${encodeURIComponent(path)}`);
}

/** Sandbox stores only: test crypto into the customer's wallet. */
export async function addTestCrypto(_state: FormState, form: FormData): Promise<FormState> {
  const amount = cryptoAmount(text(form, "amount"));
  if (!amount) return { error: "Enter an amount above zero.", field: "amount" };
  const result = await customerApi("POST", "/v1/store/crypto/test-deposits", { asset: text(form, "asset"), amount });
  if (!result.ok) return { error: result.message, field: result.param };
  revalidatePath("/account/crypto");
  return { notice: `Added ${amount} test ${text(form, "asset")}.` };
}

/**
 * Quick buy or sell: finds the best ad for the amount (fiat) and goes to the confirmation, where the customer sees
 * exactly what they get before anything moves.
 */
export async function findBestPrice(_state: FormState, form: FormData): Promise<FormState> {
  const fiat = toMinor(text(form, "fiat"));
  if (!fiat) return { error: "Enter how much you want to trade.", field: "fiat" };
  const side = text(form, "side") === "sell" ? "sell" : "buy";
  const asset = text(form, "asset");
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
export async function confirmTrade(_state: FormState, form: FormData): Promise<FormState> {
  const fiat = Number(text(form, "fiat"));
  // The fee rate the customer was shown: a changed fee is refused, like a changed price.
  const feeBps = text(form, "fee_bps");
  const result = await customerApi<StoreP2pTrade>("POST", "/v1/store/p2p/trades", { ad_id: text(form, "ad_id"), price: Number(text(form, "price")), ...(feeBps ? { fee_bps: Number(feeBps) } : {}), fiat });
  if (!result.ok) {
    signInFirst(result.status, "/account/crypto");
    if (result.code === "insufficient_funds") return { error: result.message, field: "funds" };
    return { error: result.message };
  }
  revalidatePath("/account/crypto");
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
  revalidatePath("/account/crypto");
  redirect("/account/crypto/ads?posted=1");
}

/** Pauses, resumes or closes one of the customer's ads (closing gives back what it locks). */
export async function changeAd(form: FormData) {
  const id = encodeURIComponent(text(form, "id"));
  const op = text(form, "op");
  if (op === "cancel") await customerApi("POST", `/v1/store/p2p/ads/${id}/cancel`);
  else await customerApi("PATCH", `/v1/store/p2p/ads/${id}`, { status: op === "resume" ? "active" : "paused" });
  revalidatePath("/account/crypto/ads");
  revalidatePath("/account/crypto");
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
  revalidatePath("/account/crypto");
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

export async function removeWithdrawalAddress(form: FormData) {
  await customerApi("DELETE", `/v1/store/crypto/withdrawal-addresses/${encodeURIComponent(text(form, "id"))}`);
  revalidatePath("/account/crypto/withdraw");
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
export async function createWithdrawal(_state: FormState, form: FormData): Promise<FormState> {
  const result = await customerApi<StoreCryptoWithdrawal>("POST", "/v1/store/crypto/withdrawals", {
    asset: text(form, "asset"),
    chain: text(form, "chain"),
    address_id: text(form, "address_id"),
    amount: text(form, "amount"),
  });
  if (!result.ok) {
    signInFirst(result.status, "/account/crypto/withdraw");
    return { error: result.message };
  }
  revalidatePath("/account/crypto");
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

export async function cancelWithdrawal(form: FormData) {
  const id = text(form, "id");
  await customerApi("POST", `/v1/store/crypto/withdrawals/${encodeURIComponent(id)}/cancel`);
  revalidatePath(`/account/crypto/withdrawals/${id}`);
  revalidatePath("/account/crypto");
}
