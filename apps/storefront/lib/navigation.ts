import type { StoreCountry, StoreNavigationGroup } from "@bitocard/api-client/storefront";
import { storeApi } from "./api";

/** The menu and countries every store page shares; empty (rather than failing) while the API is unreachable. */
export async function storeNavigation() {
  const result = await storeApi<{ groups: StoreNavigationGroup[]; countries: StoreCountry[] }>("/v1/store/navigation");
  return result.ok ? result.data : { groups: [], countries: [] };
}
