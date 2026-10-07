import type { StoreCountry, StoreNavigationGroup } from "@bitocard/api-client/storefront";
import { storeApi } from "./api";
import { inMarket } from "./market";

/** The menu (for the shopper's market) and countries every store page shares; empty (rather than failing) while the API is unreachable. */
export async function storeNavigation() {
  const result = await storeApi<{ groups: StoreNavigationGroup[]; countries: StoreCountry[] }>(await inMarket("/v1/store/navigation"));
  return result.ok ? result.data : { groups: [], countries: [] };
}
