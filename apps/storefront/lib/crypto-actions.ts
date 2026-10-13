"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { StoreP2pAd, StoreP2pProfile, StoreP2pQuote, StoreP2pTrade } from "@bitocard/api-client/storefront";
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
  const result = await customerApi<StoreP2pTrade>("POST", "/v1/store/p2p/trades", { ad_id: text(form, "ad_id"), price: Number(text(form, "price")), fiat });
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
