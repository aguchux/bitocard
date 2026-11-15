import type { StoreAirtimePool, StoreAirtimePurchase, StoreAirtimeSale, StoreAirtimeSeller, StoreList } from "@bitocard/api-client/storefront";
import { storeApi } from "./api";
import { customerApi } from "./customer";

/**
 * The airtime exchange on bitocard.com (docs/BITOCARD_AIRTIME_EXCHANGE_PLAN.md): the pool everyone sees, read fresh
 * (it changes with every trade), and the signed-in customer's own sales and purchases. Rules shared with the browser
 * are in `airtime-rules.ts`.
 */
export async function airtimePool(country = "NG"): Promise<StoreAirtimePool | null> {
  const result = await storeApi<StoreAirtimePool>(`/v1/store/airtime/pool?country=${encodeURIComponent(country)}`, { fresh: true });
  return result.ok ? result.data : null;
}

/** Where the signed-in customer stands as a seller: strikes, a pause, and today's limit per network. */
export async function mySellerStatus(): Promise<StoreAirtimeSeller | null> {
  const result = await customerApi<StoreAirtimeSeller>("GET", "/v1/store/airtime/seller");
  return result.ok ? result.data : null;
}

export async function myAirtime() {
  const [sales, purchases] = await Promise.all([
    customerApi<StoreList<StoreAirtimeSale>>("GET", "/v1/store/airtime/sales"),
    customerApi<StoreList<StoreAirtimePurchase>>("GET", "/v1/store/airtime/purchases"),
  ]);
  return { sales: sales.ok ? sales.data.data : [], purchases: purchases.ok ? purchases.data.data : [] };
}
