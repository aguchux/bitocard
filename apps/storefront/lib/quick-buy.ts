import type { QuickBuyCategory, StoreProduct } from "@bitocard/api-client/storefront";

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
