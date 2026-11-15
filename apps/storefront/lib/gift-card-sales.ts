import "server-only";
import type { GiftCardSellOptions } from "@bitocard/api-client/storefront";
import { storeApi } from "./api";

/** Gift cards only: what a customer in `country` can sell of this product (null when the store says nothing). */
export async function sellOptionsFor(productKey: string, country: string | null) {
  if (!productKey.startsWith("gift_cards:") || !country) return null;
  const query = new URLSearchParams({ product: productKey, country });
  const result = await storeApi<GiftCardSellOptions>(`/v1/store/gift-card-sales/offers?${query.toString()}`, { fresh: true });
  return result.ok ? result.data : null;
}

/** Whether customers in `country` can sell any gift card (Home's Sell card). */
export async function sellingOpenIn(country: string | null | undefined) {
  if (!country) return false;
  const result = await storeApi<GiftCardSellOptions>(`/v1/store/gift-card-sales/offers?country=${encodeURIComponent(country)}`, { fresh: true });
  return result.ok && result.data.available;
}

/** How a sale's status reads to the customer. */
export const saleStatus: Record<string, { label: string; tone: string }> = {
  pending: { label: "Being checked", tone: "bg-amber-50 text-amber-800" },
  completed: { label: "Paid", tone: "bg-emerald-50 text-emerald-800" },
  rejected: { label: "Not accepted", tone: "bg-red-50 text-red-800" },
  failed: { label: "Not sent", tone: "bg-slate-100 text-slate-700" },
};
