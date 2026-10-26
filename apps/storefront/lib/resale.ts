import "server-only";
import type { ResaleCategoryTile, ResaleStoreListingDetail, ResaleStoreListingPage, ResaleStoreSupplier } from "@bitocard/api-client/storefront";
import { query, storeApi } from "./api";
import { currentStore } from "./store";

/** The store this request is for when it is a Resale shop (B2B reselling), else null. */
export async function resaleStore() {
  const { store } = await currentStore();
  return store && !store.house && store.design?.template === "resale_shop" ? store : null;
}

export type ResaleQuery = { category?: string; q?: string; sort?: "newest" | "price_asc" | "price_desc"; offset?: number; limit?: number };

/** What the store sells now (only listings on sale, each naming its supplier). */
export const resaleListings = (params: ResaleQuery) => storeApi<ResaleStoreListingPage>(`/v1/store/resale/listings${query(params)}`);
export const resaleListing = (ref: number) => storeApi<ResaleStoreListingDetail>(`/v1/store/resale/listings/${ref}`);
export const resaleSupplier = (id: string, ref?: number) => storeApi<ResaleStoreSupplier>(`/v1/store/resale/suppliers/${id}${query({ listing: ref })}`);
export const resaleCategories = () => storeApi<{ object: "list"; data: ResaleCategoryTile[] }>("/v1/store/resale/categories");