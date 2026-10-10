"use server";

import type { StorePaymentMethod, StorePaymentMethods, StoreWallet } from "@bitocard/api-client/storefront";
import { query, storeApi } from "@/lib/api";
import { walletFor } from "@/lib/wallet";

export type PaymentChoice = { methods: StorePaymentMethod[]; walletRequired: boolean; wallet: StoreWallet | null };

/**
 * How a shopper can pay from a country, for the buy form when they change "Paying from" (browsers never call the API:
 * the store's server asks), with their wallet there when they are signed in. Empty when the country takes no payments
 * or the API cannot be reached.
 */
export async function paymentMethodsFor(country: string): Promise<PaymentChoice> {
  if (!/^[A-Z]{2}$/.test(country)) return { methods: [], walletRequired: false, wallet: null };
  const [result, wallet] = await Promise.all([storeApi<StorePaymentMethods>(`/v1/store/payment-methods${query({ country })}`, { fresh: true }), walletFor(country)]);
  return result.ok ? { methods: result.data.data, walletRequired: Boolean(result.data.wallet_required), wallet } : { methods: [], walletRequired: false, wallet };
}
