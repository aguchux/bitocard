/**
 * Udozo POS's shapes as the API presents them (`apps/udozo-api/src/pos/`), and the words and figures the pages show.
 * Pure, so server pages, client forms and tests share them.
 */

export type PosLimits = { products: number | null; shops: number | null; tills: number | null; staff: number | null };

export type PosPlan = {
  object: "pos_plan";
  code: "free" | "premium" | "multi_shop";
  name: string;
  description: string | null;
  /** The monthly price in the market's currency (minor units); null where it is not priced there. */
  price: { amount: number; currency: string } | null;
  available: boolean;
  paid: boolean;
  limits: PosLimits;
  trial_days: number;
};

export type PosPlans = { object: "list"; country: string | null; currency: string | null; open: boolean; data: PosPlan[] };

export type PosApps = { object: "pos_apps"; android: string | null; ios: string | null; windows: string | null };

export type PosTill = { object: "pos_till"; id: string; name: string; printer_width: 58 | 80; auto_print: boolean };

export type PosShop = {
  object: "pos_shop";
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  tin: string | null;
  shop_code: string;
  vat_bps: number;
  receipt_footer: string | null;
  tills: PosTill[];
};

export type PosAccountStatus = "free" | "trial" | "active" | "cancelling" | "past_due";

export type PosAccount = {
  object: "pos_account";
  id: string;
  country: string;
  currency: string;
  mode: "live" | "test";
  status: PosAccountStatus;
  plan: PosPlan;
  next_plan: PosPlan["code"] | null;
  trial_ends_at: string | null;
  period_start: string | null;
  period_end: string | null;
  past_due_since: string | null;
  drops_to_free_at: string | null;
  lapsed_plan: PosPlan["code"] | null;
  limits: PosLimits;
  shops: PosShop[];
  created_at: string;
};

export type PosOwner = {
  object: "pos_owner";
  open: boolean;
  country: string;
  currency: string;
  wallet: { balance: number; currency: string };
  plans: PosPlan[];
  account: PosAccount | null;
};

export type PosCharge = {
  object: "pos_charge";
  id: string;
  number: string;
  plan: { code: string; name: string };
  kind: "signup" | "renewal" | "upgrade";
  period_start: string;
  period_end: string;
  price: number;
  credit: number;
  amount: number;
  currency: string;
  created_at: string;
};

const symbols: Record<string, string> = { NGN: "₦", GHS: "GH₵", KES: "KSh ", USD: "$", GBP: "£", EUR: "€", ZAR: "R ", UGX: "USh ", RWF: "RF ", ZMW: "ZK " };

/** An amount in minor units, written for people: ₦15,000, or ₦15,000.50 when it has kobo. */
export function money(amount: number, currency: string) {
  const whole = amount % 100 === 0;
  const text = (amount / 100).toLocaleString("en-GB", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
  return `${symbols[currency] ?? `${currency} `}${text}`;
}

/** A plan's monthly price in words: Free, its price a month, or that it is not offered in this country yet. */
export function priceText(plan: Pick<PosPlan, "paid" | "price">) {
  if (!plan.paid) return "Free";
  return plan.price ? `${money(plan.price.amount, plan.price.currency)} a month` : "Price coming soon";
}

/** One limit in words: "Unlimited tills", "1 shop", "50 products at the till". */
export function limitText(key: keyof PosLimits, value: number | null) {
  const nouns: Record<keyof PosLimits, [string, string]> = { products: ["product at the till", "products at the till"], shops: ["shop", "shops"], tills: ["till", "tills"], staff: ["staff member", "staff"] };
  const [one, many] = nouns[key];
  if (value === null) return `Unlimited ${many}`;
  return `${value.toLocaleString("en-GB")} ${value === 1 ? one : many}`;
}

/** What each plan includes, from its limits, in the order the pricing table shows them. */
export function planFeatures(plan: Pick<PosPlan, "limits" | "paid">) {
  const lines = (["shops", "tills", "staff", "products"] as const).map(key => limitText(key, plan.limits[key]));
  return [...lines, "One stock count with your udozo.com listings", plan.paid ? "Paid monthly from your Udozo wallet" : "No payment needed"];
}

/** The plans in their order: Free, Premium, then Multi-shop. */
export const planOrder: PosPlan["code"][] = ["free", "premium", "multi_shop"];
export const sortPlans = <T extends Pick<PosPlan, "code">>(plans: T[]) => [...plans].sort((a, b) => planOrder.indexOf(a.code) - planOrder.indexOf(b.code));

/** What signing up for a plan takes from the wallet today: nothing for Free or a trial, else its first month. */
export function dueToday(plan: Pick<PosPlan, "paid" | "price" | "trial_days">) {
  if (!plan.paid || plan.trial_days > 0 || !plan.price) return 0;
  return plan.price.amount;
}

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/** Where the account's plan stands, in one sentence. */
export function statusText(account: Pick<PosAccount, "status" | "plan" | "next_plan" | "trial_ends_at" | "period_end" | "drops_to_free_at">, plans: Pick<PosPlan, "code" | "name">[] = []) {
  const name = (code: string | null) => plans.find(plan => plan.code === code)?.name ?? code ?? "";
  switch (account.status) {
    case "free":
      return "You are on Free: no payment needed.";
    case "trial":
      return `Your free trial of ${account.plan.name} ends on ${account.trial_ends_at ? day(account.trial_ends_at) : "its last day"}. The first month is then taken from your Udozo wallet.`;
    case "cancelling":
      return `${account.plan.name} runs until ${account.period_end ? day(account.period_end) : "the end of this month"}, then your shop moves to Free.`;
    case "past_due":
      return `We could not take this month's payment for ${account.plan.name}. Add funds to your Udozo wallet by ${account.drops_to_free_at ? day(account.drops_to_free_at) : "the end of the grace period"}, or your shop moves to Free.`;
    default:
      return account.next_plan && account.next_plan !== account.plan.code
        ? `${account.plan.name} renews on ${account.period_end ? day(account.period_end) : "its renewal date"}, when your shop moves to ${name(account.next_plan)}.`
        : `${account.plan.name} renews on ${account.period_end ? day(account.period_end) : "its renewal date"}, from your Udozo wallet.`;
  }
}

export const vatText = (bps: number) => `${(bps / 100).toLocaleString("en-GB", { maximumFractionDigits: 2 })}%`;

/** The VAT a person types ("7.5", "7.5%") in basis points, or null when it is not a rate from 0% to 50%. */
export function readVat(input: string) {
  const text = input.trim().replace(/%$/, "").trim();
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(text)) return null;
  const bps = Math.round(Number(text) * 100);
  return bps >= 0 && bps <= 5000 ? bps : null;
}

/** Each app's button: its store link, or Coming soon while admins have not set it (never a link that goes nowhere). */
export const appPlatforms = [
  { key: "android", name: "Android", store: "Google Play", lead: "Get it on" },
  { key: "ios", name: "iPhone and iPad", store: "App Store", lead: "Download on the" },
  { key: "windows", name: "Windows", store: "Microsoft Store", lead: "Get it from the" },
] as const;

// ---- The catalogue: the owner's listings ticked Sell at POS on udozo.com (milestone 2) ----

/** Why the till cannot sell a product now: the plan's product limit, not live on udozo.com yet, no price, or none free. */
export type PosProductBlock = "plan_limit" | "not_live" | "no_price" | "out_of_stock";

export type PosProduct = {
  object: "pos_product";
  id: string;
  ref: number;
  sku: string | null;
  title: string | null;
  price: { kind: "fixed" | "negotiable" | "on_request"; amount: number | null; currency: string };
  barcode: string | null;
  category: { id: string; name: string; parent: { id: string; name: string } | null } | null;
  photo_url: string | null;
  status: string;
  stock: number;
  /** Units held for online buyers: never sold at the till. */
  held: number;
  available: number;
  reorder_level: number | null;
  low_stock: boolean;
  /** Also on udozo.com; false for a shop-only listing. */
  on_udozo: boolean;
  blocked: PosProductBlock | null;
  ticked_at: string;
  /** The listing on udozo.com, where its price, photos, stock and barcode are changed. */
  edit_url: string;
};

export type PosCatalogue = {
  object: "list";
  currency: string;
  plan: { code: string; name: string };
  summary: { products: number; limit: number | null; over_limit: number; sellable: number; low_stock: number; out_of_stock: number };
  categories: Array<{ id: string; name: string; count: number }>;
  total: number;
  has_more: boolean;
  data: PosProduct[];
};

export const catalogueViews = [
  { value: "all", label: "All" },
  { value: "sellable", label: "Selling" },
  { value: "low_stock", label: "Low stock" },
  { value: "out_of_stock", label: "Out of stock" },
  { value: "blocked", label: "Not selling" },
] as const;
export type CatalogueView = (typeof catalogueViews)[number]["value"];

/** How many products a page shows. */
export const cataloguePage = 24;

/** The catalogue's filters from the address, cleaned: unknown views fall back to All, pages start at 1. */
export function catalogueQuery(params: { q?: string; show?: string; category?: string; page?: string }) {
  const show: CatalogueView = catalogueViews.some(view => view.value === params.show) ? (params.show as CatalogueView) : "all";
  const page = Math.max(1, Math.floor(Number(params.page) || 1));
  const q = (params.q ?? "").trim().slice(0, 80);
  const category = /^[0-9a-f-]{36}$/i.test(params.category ?? "") ? params.category! : "";
  const search = new URLSearchParams({ show, limit: String(cataloguePage), offset: String((page - 1) * cataloguePage) });
  if (q) search.set("q", q);
  if (category) search.set("category", category);
  return { show, page, q, category, api: `?${search.toString()}` };
}

/** Why a product does not sell at the till, in words. */
export function blockText(product: Pick<PosProduct, "blocked" | "status">, planName: string) {
  switch (product.blocked) {
    case "plan_limit":
      return `Over ${planName}'s product limit: choose a bigger plan, or untick Sell at POS on another listing.`;
    case "not_live":
      return product.status === "pending_review" ? "Waiting for Udozo's review: it sells once it is live." : product.status === "draft" ? "A draft: post it on udozo.com to sell it." : "Not live on udozo.com: renew or edit it there.";
    case "no_price":
      return "No price: give it one on udozo.com to sell it at the till.";
    case "out_of_stock":
      return "None free to sell: restock it on udozo.com.";
    default:
      return null;
  }
}

/** The stock line: what the till can sell, and what online buyers hold. */
export function stockLine(product: Pick<PosProduct, "stock" | "held" | "available">) {
  if (product.stock === 0) return "Out of stock";
  const free = `${product.available.toLocaleString("en-GB")} free to sell`;
  return product.held > 0 ? `${free} (${product.held.toLocaleString("en-GB")} held for online buyers)` : free;
}
