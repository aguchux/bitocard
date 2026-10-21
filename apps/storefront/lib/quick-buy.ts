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

/** What the quick-buy form asks for a product: the number's label and keyboard, and whether it needs an amount. */
export function quickBuyNeeds(category: QuickBuyCategory, product: Pick<StoreProduct, "denomination_type">) {
  const meter = category === "bills";
  const card = category === "pay_tv";
  return {
    numberLabel: meter ? "Meter number" : card ? "Smartcard or IUC number" : category === "mobile_money" ? "Mobile money number" : "Mobile number",
    numberMode: (meter || card ? "numeric" : "tel") as "numeric" | "tel",
    amount: product.denomination_type === "range",
  };
}

/** The product's page with the number (and amount) filled into its buy form. */
export function quickBuyHref(key: string, fill: { number: string; amount: string }) {
  const params = new URLSearchParams();
  if (fill.number.trim()) params.set("number", fill.number.trim());
  if (fill.amount.trim()) params.set("amount", fill.amount.trim());
  const search = params.toString();
  return `/p/${encodeURIComponent(key)}${search ? `?${search}` : ""}`;
}

/** The buy form's starting values from its page's address (`?number=`, `?amount=`), cleaned. */
export function prefillFrom(search: string) {
  const params = new URLSearchParams(search);
  const clean = (value: string | null, pattern: RegExp) => (value && pattern.test(value.trim()) ? value.trim() : "");
  return { number: clean(params.get("number"), /^[+\d\s()-]{3,24}$/), amount: clean(params.get("amount"), /^\d{1,9}(\.\d{1,2})?$/) };
}
