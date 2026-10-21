"use server";

import { refresh } from "next/cache";
import type { StoreEsimTopUp, StoreEsimTopUpOptions } from "@bitocard/api-client/storefront";
import { accessApi, accessToken } from "@/lib/access";
import { customerApi } from "@/lib/customer";

/**
 * Where an eSIM's order is managed from: the customer's own checkout (signed in, `/account/orders/<id>`) or its order
 * link (`/a/<token>`, with the customer's proof).
 */
export type EsimSource = { checkout: string } | { token: string };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Result<T> = { ok: true; data: T } | { ok: false; error: string };

async function call<T>(source: EsimSource, esimId: string, action: "top-up-options" | "top-ups" | "cancel", body?: unknown, idempotencyKey?: string): Promise<Result<T>> {
  if (!uuid.test(esimId)) return { ok: false, error: "This eSIM was not found." };
  if ("checkout" in source) {
    if (!uuid.test(source.checkout)) return { ok: false, error: "This order was not found." };
    const result = await customerApi<T>(action === "top-up-options" ? "GET" : "POST", `/v1/store/checkouts/${source.checkout}/esims/${esimId}/${action}`, action === "top-up-options" ? undefined : (body ?? {}), { idempotencyKey });
    return result.ok ? { ok: true, data: result.data } : { ok: false, error: result.message };
  }
  if (!accessToken.test(source.token)) return { ok: false, error: "This link is not valid." };
  const result = await accessApi<T>(source.token, `/esims/${esimId}/${action}`, action === "top-up-options" ? undefined : (body ?? {}), { idempotencyKey });
  return result.ok ? { ok: true, data: result.data } : { ok: false, error: result.status === 401 ? "Your access has ended. Reload the page to confirm it is you again." : result.message };
}

/** The top-ups the eSIM takes now, at the store's price, and the customer's wallets. */
export async function esimTopUpOptions(source: EsimSource, esimId: string) {
  return call<StoreEsimTopUpOptions>(source, esimId, "top-up-options");
}

/**
 * Pays a top-up from the customer's wallet (`wallet_currency`: their country's, or USD). `attempt` is the form's nonce:
 * sent again (a double submit, another tab's retry) it pays once.
 */
export async function topUpEsim(source: EsimSource, esimId: string, optionId: string, walletCurrency: string, attempt?: string) {
  if (!/^opt_[a-f0-9]{8,40}$/.test(optionId)) return { ok: false as const, error: "Choose a top-up." };
  const result = await call<StoreEsimTopUp>(source, esimId, "top-ups", { option_id: optionId, ...(/^[A-Z]{3}$/.test(walletCurrency) ? { wallet_currency: walletCurrency } : {}) }, attempt);
  if (result.ok) refresh();
  return result;
}

/** Cancels the order's eSIMs (none installed) for a refund. */
export async function cancelEsim(source: EsimSource, esimId: string) {
  const result = await call<{ refunded: boolean }>(source, esimId, "cancel");
  if (result.ok) refresh();
  return result;
}
