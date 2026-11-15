"use server";

import { revalidatePath } from "next/cache";
import type { GiftCardSale, GiftCardSaleQuote } from "@bitocard/api-client/storefront";
import { customerApi } from "./customer";

const uuid = /^[0-9a-f-]{36}$/i;

/** What the customer would get for a card of this value: the exact amount, asked before they send it. */
export async function quoteSale(offerId: string, amount: number): Promise<{ ok: true; payout: number; currency: string } | { ok: false; message: string; code: string | null }> {
  if (!uuid.test(offerId) || !Number.isInteger(amount) || amount < 1) return { ok: false, message: "Enter the card’s value.", code: null };
  const result = await customerApi<GiftCardSaleQuote>("POST", "/v1/store/gift-card-sales/quote", { offer_id: offerId, amount });
  return result.ok ? { ok: true, payout: result.data.payout, currency: result.data.currency } : { ok: false, message: result.message, code: result.code };
}

/** BitoCard's sandbox: decides a sale as the buyer would. */
export async function simulateSale(id: string, outcome: "approved" | "rejected") {
  if (!uuid.test(id)) return;
  await customerApi<GiftCardSale>("POST", `/v1/store/gift-card-sales/${id}/simulate`, { outcome });
  revalidatePath(`/account/sold/${id}`);
}
