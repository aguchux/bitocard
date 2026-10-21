import "server-only";
import type { QuickBuyCategory, StoreList, StoreProduct } from "@bitocard/api-client/storefront";
import { storeApi } from "./api";
import { inMarket } from "./market";

/** The tabs a top-up quick-buy form needs: a label and every on-sale product, one category at a time. */
const quickBuyTabs: Array<{ category: QuickBuyCategory; label: string }> = [
  { category: "airtime", label: "Airtime" },
  { category: "data", label: "Data" },
  { category: "bills", label: "Electricity" },
  { category: "pay_tv", label: "TV" },
  { category: "mobile_money", label: "Mobile money" },
];

/**
 * Every top-up tab with products on sale (airtime, data, bills, pay TV, mobile money), for the account app's own
 * quick-buy form on Home. Mirrors the API's `quick_buy` section (`StorefrontService`), one products read per category.
 * Kept apart from `lib/quick-buy.ts` (shared with the client `QuickBuyForm`), which must stay free of server-only code.
 */
export async function homeQuickBuyTabs() {
  const results = await Promise.all(
    quickBuyTabs.map(async tab => {
      const result = await storeApi<StoreList<StoreProduct>>(await inMarket(`/v1/store/products?category=${tab.category}&limit=48`));
      return { ...tab, products: result.ok ? result.data.data : [] };
    }),
  );
  return results.filter(tab => tab.products.length);
}
