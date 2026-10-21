"use server";

import type { StoreList, StoreProduct } from "@bitocard/api-client/storefront";
import { query, storeApi } from "@/lib/api";

type NetworkDetection = { object: "network_detection"; detected: boolean; brand?: string | null; product: StoreProduct | null };

export type NetworkGuess = { detected: boolean; product: StoreProduct | null };

/**
 * Which network a mobile number belongs to, and the matching airtime or data product on sale (the store's server
 * asks; browsers never call the API). `detected: false` asks the customer to choose a network themselves.
 */
export async function detectNetwork(phone: string, country: string, category: "airtime" | "data", currency?: string): Promise<NetworkGuess> {
  if (!phone.trim() || !/^[A-Za-z]{2}$/.test(country)) return { detected: false, product: null };
  const result = await storeApi<NetworkDetection>(`/v1/store/network-detect${query({ phone, country, category, currency })}`, { fresh: true });
  return result.ok ? { detected: result.data.detected, product: result.data.product } : { detected: false, product: null };
}

/** Every product of a category and country, for the network picker (detection failed) and data's bundle picker. */
export async function topUpProducts(category: "airtime" | "data", country: string, currency?: string): Promise<StoreProduct[]> {
  const result = await storeApi<StoreList<StoreProduct>>(`/v1/store/products${query({ category, country, currency, limit: 48 })}`, { fresh: true });
  return result.ok ? result.data.data : [];
}
