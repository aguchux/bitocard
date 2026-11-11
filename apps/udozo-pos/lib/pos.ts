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
  /** What kind of shop it is; the till leads with its categories. */
  kind: PosShopKind;
  tills: PosTill[];
};

/** A kind of shop the till is tailored to, with its udozo.com category slugs. */
export type PosShopKind = { code: string; name: string; categories: string[] };

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

/** Why the till cannot sell a product now: the plan's product limit, no title yet, no price, or none free. */
export type PosProductBlock = "plan_limit" | "incomplete" | "no_price" | "out_of_stock";

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
  /** The shop's kind: its categories come first (`featured`). */
  shop_kind: { code: string; name: string };
  summary: { products: number; limit: number | null; over_limit: number; sellable: number; low_stock: number; out_of_stock: number };
  categories: Array<{ id: string; name: string; count: number; featured: boolean }>;
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
    case "incomplete":
      return "No title yet: finish it on udozo.com to sell it.";
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

// ---- Sales at the till (milestone 3) ----

export type PosPaymentMethod = "cash" | "transfer" | "card" | "other";

export const paymentMethods: Array<{ value: PosPaymentMethod; label: string; hint: string }> = [
  { value: "cash", label: "Cash", hint: "Counted at the counter, with change." },
  { value: "transfer", label: "Transfer", hint: "To your shop's own bank account: check it arrived." },
  { value: "card", label: "Card", hint: "On your own card terminal." },
  { value: "other", label: "Other", hint: "Anything else, recorded as it is." },
];

export const methodLabel = (method: string) => paymentMethods.find(item => item.value === method)?.label ?? method;

export type PosSaleLine = { listing_id: string; title: string; sku: string | null; barcode: string | null; quantity: number; unit_price: number; discount: number; total: number };
export type PosSalePayment = { method: PosPaymentMethod; amount: number; tendered: number | null; change: number; reference: string | null };

export type PosSale = {
  object: "pos_sale";
  id: string;
  number: string;
  client_sale_id: string;
  status: "completed" | "refunded";
  shop: { id: string; name: string };
  till: { id: string | null; name: string };
  currency: string;
  items: number;
  subtotal: number;
  discount: number;
  vat_bps: number;
  vat: number;
  total: number;
  change: number;
  lines: PosSaleLine[];
  payments: PosSalePayment[];
  sold_by: string;
  note: string | null;
  refunded_at: string | null;
  refund_reason: string | null;
  restocked: boolean | null;
  created_at: string;
  client_created_at: string | null;
};

export type PosSales = {
  object: "list";
  currency: string;
  summary: { sales: number; takings: number; refunds: number; refunded: number };
  total: number;
  has_more: boolean;
  data: PosSale[];
};

export type PosStockMovement = { object: "pos_stock_movement"; id: string; reason: "sale" | "refund" | "restock" | "count" | "damage"; delta: number; stock_after: number; sale: { id: string; number: string | null } | null; note: string | null; by: string | null; created_at: string };

/** A line in the till's basket. */
export type CartLine = { id: string; unit: number; quantity: number; discount?: number };

/**
 * The basket's totals in minor units, worked out exactly as Udozo does (`apps/udozo-api/src/pos/money.ts`): the lines
 * less their discounts, less the sale's discount, then VAT at the shop's rate, rounded half up. The till sends the total
 * it shows; Udozo refuses a sale whose total moved.
 */
export function tillTotals(lines: readonly CartLine[], options: { discount?: number; vatBps?: number } = {}) {
  const zero = BigInt(0);
  let items = 0;
  let subtotal = zero;
  let lineDiscounts = zero;
  for (const line of lines) {
    const gross = BigInt(line.unit) * BigInt(line.quantity);
    const off = BigInt(Math.max(0, line.discount ?? 0));
    items += line.quantity;
    subtotal += gross;
    lineDiscounts += off > gross ? gross : off;
  }
  const afterLines = subtotal - lineDiscounts;
  const asked = BigInt(Math.max(0, options.discount ?? 0));
  const discount = lineDiscounts + (asked > afterLines ? afterLines : asked);
  const taxable = subtotal - discount;
  const vat = (taxable * BigInt(options.vatBps ?? 0) + BigInt(5000)) / BigInt(10000);
  return { items, subtotal: Number(subtotal), discount: Number(discount), vat: Number(vat), total: Number(taxable + vat) };
}

/** An amount a person types ("1,500", "1500.50") in minor units, or null. */
export function readAmount(input: string) {
  const text = input.replace(/[,\s₦$£€]/g, "").trim();
  if (!/^\d{1,13}(\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

/** Amounts the cashier can tap for cash handed over: the exact amount, then round notes above it. */
export function cashSuggestions(amount: number) {
  if (amount <= 0) return [];
  const notes = [100_00, 200_00, 500_00, 1_000_00, 2_000_00, 5_000_00, 10_000_00, 20_000_00, 50_000_00];
  const above = new Set<number>([amount]);
  for (const note of notes) {
    const rounded = Math.ceil(amount / note) * note;
    if (rounded > amount) above.add(rounded);
    if (above.size >= 4) break;
  }
  return [...above].sort((a, b) => a - b);
}

/** A product is found by its barcode, SKU or listing number exactly (what a scanner types), else by words in its name. */
export function findProducts<T extends Pick<PosProduct, "title" | "sku" | "barcode" | "ref">>(products: readonly T[], words: string) {
  const text = words.trim().toLowerCase();
  if (!text) return { exact: null, matches: [...products] };
  const exact = products.find(product => product.barcode?.toLowerCase() === text || product.sku?.toLowerCase() === text || String(product.ref) === text) ?? null;
  const matches = products.filter(product => (product.title ?? "").toLowerCase().includes(text) || product.sku?.toLowerCase().includes(text) || product.barcode?.toLowerCase() === text || String(product.ref) === text);
  return { exact, matches };
}

/** A sale's moment in the shop's day: "11 November 2026, 14:05". */
export const saleTime = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" });

export const salesPage = 25;

/** Today in the shop's day (Lagos time, UTC+1), as YYYY-MM-DD. */
export const shopToday = (now = new Date()) => new Date(now.getTime() + 3_600_000).toISOString().slice(0, 10);

/** The sales list's filters from the address, cleaned. */
export function salesQuery(params: { q?: string; status?: string; day?: string; page?: string }) {
  const status = params.status === "completed" || params.status === "refunded" ? params.status : "";
  const page = Math.max(1, Math.floor(Number(params.page) || 1));
  const q = (params.q ?? "").trim().replace(/[^A-Za-z0-9-]/g, "").slice(0, 20);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(params.day ?? "") ? params.day! : "";
  const search = new URLSearchParams({ limit: String(salesPage), offset: String((page - 1) * salesPage) });
  if (status) search.set("status", status);
  if (q) search.set("q", q);
  if (day) {
    // The shop's day, in Lagos time (UTC+1).
    const from = new Date(`${day}T00:00:00+01:00`);
    search.set("from", from.toISOString());
    search.set("to", new Date(from.getTime() + 86_400_000).toISOString());
  }
  return { status, page, q, day, api: `?${search.toString()}` };
}

const movementWords: Record<PosStockMovement["reason"], string> = { sale: "Sold", refund: "Refunded", restock: "Restocked", count: "Counted", damage: "Damaged or lost" };
export const movementText = (movement: Pick<PosStockMovement, "reason" | "delta">) => `${movementWords[movement.reason]} ${movement.delta > 0 ? "+" : ""}${movement.delta.toLocaleString("en-GB")}`;
