"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { StoreExchangeQuote, StoreExchangeTrade } from "@bitocard/api-client/storefront";
import { customerApi } from "@/lib/customer";

export type ExchangeResult<T> = { ok: true; data: T } | { ok: false; code: string | null; message: string; param: string | null };

const signInFirst = (status: number) => {
  if (status === 401) redirect(`/signin?next=${encodeURIComponent("/account/crypto/exchange")}`);
};

/** A price held for 30 seconds for exactly what the customer typed (coins or money). */
export async function quoteExchange(input: { asset: string; side: "buy" | "sell"; amount?: string; fiat?: number }): Promise<ExchangeResult<StoreExchangeQuote>> {
  const result = await customerApi<StoreExchangeQuote>("POST", "/v1/store/exchange/quotes", input);
  if (result.ok) return result;
  signInFirst(result.status);
  return { ok: false, code: result.code, message: result.message, param: result.param };
}

/**
 * Settles the held price at once. `nonce` is made when the review opened, sent as the Idempotency-Key, so a double tap
 * trades once.
 */
export async function tradeExchange(quoteId: string, nonce: string): Promise<ExchangeResult<StoreExchangeTrade>> {
  const result = await customerApi<StoreExchangeTrade>("POST", "/v1/store/exchange/trades", { quote_id: quoteId }, { idempotencyKey: nonce });
  if (!result.ok) {
    signInFirst(result.status);
    return { ok: false, code: result.code, message: result.message, param: result.param };
  }
  revalidatePath("/account/crypto/exchange");
  revalidatePath("/account/crypto");
  revalidatePath("/account/wallet");
  return result;
}
