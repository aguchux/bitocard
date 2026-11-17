import "server-only";
import type { StoreProductDetail, StoreRate, StoreRateShown } from "@bitocard/api-client/storefront";
import { query, storeApi } from "./api";

/**
 * A gift card's rate on this store for the country the shopper pays from (what its customers pay per unit of the card's
 * currency, and for each value), or null: not a gift card, no country yet, or not sold by rate here. Read straight
 * from the API's rate route, never through `withPrices` (which would ask for a currency the rate does not take).
 */
export async function rateFor(product: Pick<StoreProductDetail, "key" | "category">, country: string | null): Promise<StoreRateShown | null> {
  if (product.category !== "gift_cards" || !country) return null;
  const result = await storeApi<StoreRate>(`/v1/store/products/${encodeURIComponent(product.key)}/rate${query({ country })}`);
  return result.ok && result.data.rate !== null ? result.data : null;
}
