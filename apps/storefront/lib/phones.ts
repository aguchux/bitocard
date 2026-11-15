import type { StoreCustomerPhones } from "@bitocard/api-client/storefront";
import { customerApi } from "./customer";

/** The signed-in customer's confirmed mobile numbers (the default first); null when they cannot be read. */
export async function myPhones(): Promise<StoreCustomerPhones | null> {
  const result = await customerApi<StoreCustomerPhones>("GET", "/v1/store/account/phones");
  return result.ok ? result.data : null;
}
