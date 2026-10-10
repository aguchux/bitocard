"use server";

import type { StorePaymentMethod, StorePaymentMethods } from "@bitocard/api-client/storefront";
import { query, storeApi } from "@/lib/api";

/**
 * How a shopper can pay from a country, for the buy form when they change "Paying from" (browsers never call the API:
 * the store's server asks). Empty when the country takes no payments or the API cannot be reached.
 */
export async function paymentMethodsFor(country: string): Promise<StorePaymentMethod[]> {
  if (!/^[A-Z]{2}$/.test(country)) return [];
  const result = await storeApi<StorePaymentMethods>(`/v1/store/payment-methods${query({ country })}`, { fresh: true });
  return result.ok ? result.data.data : [];
}
