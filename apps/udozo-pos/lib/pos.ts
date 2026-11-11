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
  /** The yearly price where finance set one (null: monthly only). */
  yearly_price?: { amount: number; currency: string } | null;
  available: boolean;
  paid: boolean;
  limits: PosLimits;
  trial_days: number;
};

export type BillingInterval = "month" | "year";

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
  /** Shown on invoices. */
  email?: string | null;
  /** The shop's own bank account for later payments, printed on invoices (never used by Udozo). */
  bank?: { name: string | null; account_name: string | null; account_number: string | null } | null;
  /** Printed receipts carry the QR code that gets the PDF on WhatsApp. */
  receipt_qr?: boolean;
  /** The main shop (first), the one online orders take from, and paused (past the plan's shop limit). */
  main?: boolean;
  fulfils_online?: boolean;
  paused?: boolean;
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
  /** Paid monthly or yearly, and the interval taking over when the paid period ends. */
  billing_interval?: BillingInterval;
  next_interval?: BillingInterval | null;
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
  /** The till may take payment from a buyer's Udozo wallet (the market's `pos_wallet_payments`). */
  wallet_payments?: boolean;
  /** Owners on a paid plan may ask for Udozo collection accounts for their tills (the market's `pos_collections`). */
  collections?: boolean;
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
  interval?: BillingInterval;
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
export function priceText(plan: Pick<PosPlan, "paid" | "price" | "yearly_price">, interval: BillingInterval = "month") {
  if (!plan.paid) return "Free";
  if (interval === "year") return plan.yearly_price ? `${money(plan.yearly_price.amount, plan.yearly_price.currency)} a year` : "Monthly only";
  return plan.price ? `${money(plan.price.amount, plan.price.currency)} a month` : "Price coming soon";
}

/** What paying yearly saves against twelve months, as a whole percentage; null without both prices or a saving. */
export function yearlySaving(plan: Pick<PosPlan, "price" | "yearly_price">) {
  if (!plan.price || !plan.yearly_price) return null;
  const twelve = plan.price.amount * 12;
  const saving = Math.round(((twelve - plan.yearly_price.amount) / twelve) * 100);
  return saving > 0 ? saving : null;
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
export function dueToday(plan: Pick<PosPlan, "paid" | "price" | "yearly_price" | "trial_days">, interval: BillingInterval = "month") {
  const price = interval === "year" ? plan.yearly_price : plan.price;
  if (!plan.paid || plan.trial_days > 0 || !price) return 0;
  return price.amount;
}

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/** Where the account's plan stands, in one sentence. */
export function statusText(account: Pick<PosAccount, "status" | "plan" | "next_plan" | "next_interval" | "trial_ends_at" | "period_end" | "drops_to_free_at">, plans: Pick<PosPlan, "code" | "name">[] = []) {
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
      if (account.next_interval && (!account.next_plan || account.next_plan === account.plan.code)) {
        return `${account.plan.name} is paid until ${account.period_end ? day(account.period_end) : "its renewal date"}, then renews ${account.next_interval === "year" ? "yearly" : "monthly"}.`;
      }
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
  /** Several shops: each shop's level, and what is in no shop (online). */
  levels?: { online: number; shops: Array<{ shop_id: string; quantity: number }> } | null;
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
  /** Several shops: stock is split between them, and `available` is the asked shop's. */
  split?: boolean;
  shop?: { id: string; name: string } | null;
  shops?: Array<{ id: string; name: string; fulfils_online: boolean }>;
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
/** With several shops, where a product's stock is: "Ikeja shop 5 · Lekki shop 3 · Online 2" (online only when there is some). */
export function levelsText(product: Pick<PosProduct, "levels">, shops: Array<{ id: string; name: string }>) {
  if (!product.levels) return null;
  const parts = shops.map(shop => `${shop.name} ${(product.levels!.shops.find(level => level.shop_id === shop.id)?.quantity ?? 0).toLocaleString("en-GB")}`);
  if (product.levels.online > 0) parts.push(`Online ${product.levels.online.toLocaleString("en-GB")}`);
  return parts.join(" · ");
}

export function stockLine(product: Pick<PosProduct, "stock" | "held" | "available">) {
  if (product.stock === 0) return "Out of stock";
  const free = `${product.available.toLocaleString("en-GB")} free to sell`;
  return product.held > 0 ? `${free} (${product.held.toLocaleString("en-GB")} held for online buyers)` : free;
}

// ---- Sales at the till (milestone 3) ----

/** What the till records itself; the Udozo wallet (`udozo_wallet`) is asked of the buyer instead. */
export type PosPaymentMethod = "cash" | "transfer" | "card" | "other";

export const paymentMethods: Array<{ value: PosPaymentMethod; label: string; hint: string }> = [
  { value: "cash", label: "Cash", hint: "Counted at the counter, with change." },
  { value: "transfer", label: "Transfer", hint: "To your shop's own bank account: check it arrived." },
  { value: "card", label: "Card", hint: "On your own card terminal." },
  { value: "other", label: "Other", hint: "Anything else, recorded as it is." },
];

export const methodLabel = (method: string) =>
  method === "udozo_wallet" ? "Udozo wallet" : method === "udozo_transfer" ? "Transfer to your Udozo account" : method === "credit" ? "Pay later" : (paymentMethods.find(item => item.value === method)?.label ?? method);

export type PosSaleLine = { listing_id: string; title: string; sku: string | null; barcode: string | null; quantity: number; unit_price: number; discount: number; total: number };
export type PosSalePayment = { method: PosPaymentMethod | "udozo_wallet" | "udozo_transfer" | "credit"; amount: number; tendered: number | null; change: number; reference: string | null };

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
  /** The shop's customer it was sold to, if one was chosen. */
  customer?: { id: string; name: string; number: string } | null;
  sold_by: string;
  /** The member of staff who sold it (null: the owner), and who refunded it. */
  sold_by_staff_id?: string | null;
  refunded_by?: string | null;
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

// ---- The Udozo wallet at the till ----

export type PosWalletRequest = {
  object: "pos_wallet_request";
  id: string;
  number: string;
  status: "waiting" | "paid" | "declined" | "cancelled" | "expired";
  currency: string;
  amount: number;
  total: number;
  client_sale_id: string;
  for_buyer: boolean;
  expires_at: string;
  paid_at: string | null;
  sale: PosSale | null;
};

/** What the till shows while a wallet request is not paid, or null while it waits. */
export function walletOutcome(status: PosWalletRequest["status"]) {
  switch (status) {
    case "declined":
      return "The buyer declined to pay from their Udozo wallet.";
    case "expired":
      return "Five minutes passed without the buyer paying. Ask again, or take another payment.";
    case "cancelled":
      return "The request was cancelled. If the buyer was paying, ask them to look at the till again.";
    default:
      return null;
  }
}

/** Minutes and seconds left, from now to `until` ("4:05"); "0:00" once past. */
export function timeLeft(until: string, now = Date.now()) {
  const seconds = Math.max(0, Math.round((new Date(until).getTime() - now) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** How many products the till draws at once; the rest are found by search or category. */
export const tillShown = 120;

// ---- The shop's customers: its own records, no Udozo account needed ----

export type PosCustomerBrief = {
  object: "pos_customer";
  id: string;
  number: string;
  name: string;
  phone: string | null;
  email: string | null;
  /** Linked to the Udozo account they paid through Udozo with. */
  udozo: boolean;
  /** What they owe the shop for goods sold on credit, in minor units. */
  owed: number;
  credit_limit: number | null;
  sales_count: number;
  spent: number;
  last_sale_at: string | null;
};

export type PosUdozoRating = {
  member_since: string;
  in_good_standing: boolean;
  reviews: { positive: number; neutral: number; negative: number; counted: number; positive_pct: number | null } | null;
  scores: { band?: string | null; response?: string | null; attention?: string | null } | null;
};

export type PosCustomerEntry = { id: string; kind: "credit_sale" | "repayment" | "refund"; amount: number; owed_after: number; sale: { id: string; number: string | null } | null; method: string | null; reference: string | null; note: string | null; by: string | null; created_at: string };

export type PosCustomer = PosCustomerBrief & {
  address: string | null;
  notes: string | null;
  source: "shop" | "udozo";
  udozo_rating: PosUdozoRating | null;
  created_at: string;
  sales?: Array<{ id: string; number: string; status: "completed" | "refunded"; total: number; currency: string; created_at: string }>;
  entries?: PosCustomerEntry[];
};

export type PosCustomers = { object: "list"; summary: { owing: number; owed: number }; total: number; has_more: boolean; data: PosCustomerBrief[] };

export const customersPage = 25;

/** The customers list's filters from the address, cleaned. */
export function customersQuery(params: { q?: string; owing?: string; page?: string }) {
  const q = (params.q ?? "").trim().slice(0, 80);
  const owing = params.owing === "1";
  const page = Math.max(1, Math.floor(Number(params.page) || 1));
  const search = new URLSearchParams({ limit: String(customersPage), offset: String((page - 1) * customersPage) });
  if (q) search.set("q", q);
  if (owing) search.set("owing", "true");
  return { q, owing, page, api: `?${search.toString()}` };
}

const entryWords: Record<PosCustomerEntry["kind"], string> = { credit_sale: "Bought on credit", repayment: "Paid back", refund: "Refunded" };
export const entryText = (entry: Pick<PosCustomerEntry, "kind" | "method">) => `${entryWords[entry.kind]}${entry.kind === "repayment" && entry.method ? ` (${methodLabel(entry.method).toLowerCase()})` : ""}`;

/** A linked customer's Udozo rating in one line: their reviews, Anjio's words, and since when they are on Udozo. */
export function ratingText(rating: PosUdozoRating) {
  const parts: string[] = [];
  if (rating.reviews?.positive_pct != null) parts.push(`${rating.reviews.positive_pct}% positive from ${rating.reviews.counted} reviews`);
  else if (rating.reviews) parts.push(`${rating.reviews.counted} review${rating.reviews.counted === 1 ? "" : "s"}`);
  if (rating.scores?.band) parts.push(rating.scores.band);
  parts.push(`on Udozo since ${new Date(rating.member_since).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })}`);
  if (!rating.in_good_standing) parts.push("their Udozo account is suspended");
  return parts.join(" · ");
}

// ---- Udozo collection accounts and next-day settlement (milestone 4) ----

/** A till's bank account number, opened by Udozo's gateways for the shop. */
export type PosCollectionAccount = {
  object: "pos_collection_account";
  id: string;
  status: "opening" | "active" | "refused" | "closed";
  till_id: string | null;
  bank_name: string | null;
  account_number: string | null;
  account_name: string | null;
  currency: string;
  opened_at: string | null;
  closed_at: string | null;
  created_at: string;
};

export type PosCollectionsOverview = {
  object: "pos_collections";
  open: boolean;
  /** Why no new account can be opened now: not open in the country, a free plan, or no settlement account chosen. */
  blocked: "unavailable" | "plan" | "settlement_account" | null;
  currency: string;
  mode: "live" | "test";
  bvn_required: boolean;
  collected: number;
  unmatched: number;
  next_settlement: string;
  held: { at: string; reason: string | null } | null;
  settlement_bank_account_id: string | null;
  bank_accounts: Array<{ id: string; bank_name: string; last4: string; account_name: string; usable_from: string }>;
  tills: Array<{ id: string; name: string; shop: { id: string; name: string }; collection_account: PosCollectionAccount | null }>;
};

export type PosCollection = {
  object: "pos_collection";
  id: string;
  number: string;
  status: "matched" | "unmatched" | "kept";
  mode: "live" | "test";
  currency: string;
  amount: number;
  fee: number;
  collected: number;
  payer_name: string | null;
  till: { id: string | null; name: string } | null;
  sale: { id: string; number: string } | null;
  settlement: { id: string; number: string } | null;
  note: string | null;
  decided_by: string | null;
  received_at: string;
  /** The sales an unmatched transfer could be for: asked at a till for its amount, waiting or run out of time. */
  attachable?: Array<{ id: string; number: string; till: string | null; status: string; created_at: string }>;
};

export type PosCollections = { object: "list"; currency: string; total: number; has_more: boolean; data: PosCollection[] };

export type PosSettlement = {
  object: "pos_settlement";
  id: string;
  number: string;
  day: string;
  mode: "live" | "test";
  currency: string;
  collections: number;
  gross: number;
  fees: number;
  amount: number;
  status: "paying" | "kept";
  kept_reason: string | null;
  bank_account: { bank_name: string; last4: string } | null;
  payout: { id: string; status: "pending" | "processing" | "paid" | "failed"; completed_at: string | null } | null;
  created_at: string;
  items?: PosCollection[];
};

export type PosSettlements = { object: "list"; currency: string; total: number; has_more: boolean; data: PosSettlement[] };

export type PosTransferRequest = {
  object: "pos_transfer_request";
  id: string;
  number: string;
  status: "waiting" | "paid" | "cancelled" | "expired" | "failed";
  currency: string;
  amount: number;
  total: number;
  client_sale_id: string;
  pay_to: { bank_name: string | null; account_number: string | null; account_name: string | null };
  failure: string | null;
  expires_at: string;
  paid_at: string | null;
  sale_id: string | null;
};

/** Why an owner cannot open a collection account yet, in words. */
export function collectionBlockText(blocked: PosCollectionsOverview["blocked"]) {
  switch (blocked) {
    case "unavailable":
      return "Udozo collection accounts are not open in your country yet.";
    case "plan":
      return "Collection accounts come with Premium and Multi-shop.";
    case "settlement_account":
      return "Choose the bank account your collections are paid to first.";
    default:
      return null;
  }
}

/** Where a settlement stands, in words. */
export function settlementText(settlement: Pick<PosSettlement, "status" | "kept_reason" | "payout" | "bank_account">) {
  if (settlement.status === "kept") return `In your Udozo payouts: ${settlement.kept_reason ?? "pay it out from udozo.com."}`;
  const to = settlement.bank_account ? `${settlement.bank_account.bank_name} ••••${settlement.bank_account.last4}` : "your bank";
  switch (settlement.payout?.status) {
    case "paid":
      return `Paid to ${to}.`;
    case "failed":
      return `The bank refused it: it is back in your Udozo payouts. Pay it out from udozo.com.`;
    default:
      return `On its way to ${to}.`;
  }
}

/** What a transfer into a collection account is, in words. */
export function collectionText(collection: Pick<PosCollection, "status" | "sale" | "note">) {
  if (collection.status === "matched") return collection.sale ? `Paid ${collection.sale.number}` : "Paid a sale";
  if (collection.status === "kept") return collection.note ? `Kept: ${collection.note}` : "Kept, for no sale";
  return "Not matched to a sale yet";
}

/** Why the till stopped waiting for a transfer, or null while it waits or once it is paid. */
export function transferOutcome(request: Pick<PosTransferRequest, "status" | "failure">) {
  switch (request.status) {
    case "expired":
      return "30 minutes passed without the transfer. If it comes later, attach it to the sale under Payments.";
    case "cancelled":
      return "The request was cancelled.";
    case "failed":
      return `The transfer came, but the sale could not be made: ${request.failure ?? "something changed"} It is under Payments, to attach or keep.`;
    default:
      return null;
  }
}

/** A market's date, written out: Wed 25 Mar. */
export function dayText(day: string) {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

// ---- Staff, roles and tills (milestone 5) ----

/** What a role may do: the API's matrix, mirrored only to hide controls (the API decides). */
export const posPermissions = ["sell", "refund", "till", "stock_view", "stock_adjust", "prices", "own_sales", "all_sales", "cash_up", "export", "customers", "transfers", "staff", "settings"] as const;
export type PosPermission = (typeof posPermissions)[number];
export type PermissionLevel = "yes" | "approval" | "no" | "cashiers";
export type PermissionSet = Record<PosPermission, PermissionLevel>;

/** The owner may do everything; managing staff in full included. */
export const ownerPermissions = Object.fromEntries(posPermissions.map(key => [key, "yes"])) as PermissionSet;

/** Whether a set of permissions allows one at all (`approval` asks a manager; `cashiers` is staff for a manager). */
export const allows = (permissions: PermissionSet, key: PosPermission) => permissions[key] !== "no";

/** A colleague who may give a manager's PIN at this till. */
export type PosApprover = { id: string; name: string; role: string; discount_limit_bps: number | null; refund: boolean; stock_adjust: boolean };

export type PosStaffMe = {
  object: "pos_staff_me";
  staff: { id: string; name: string; first_name: string };
  role: { id: string; key: string | null; name: string; discount_limit_bps: number | null };
  permissions: PermissionSet;
  till_id: string | null;
  tills: "all" | string[];
  device: string | null;
  open: boolean;
  wallet_payments: boolean;
  collections: boolean;
  country: string;
  currency: string;
  account: { id: string; mode: "live" | "test"; plan: { code: string; name: string }; shops: PosShop[] };
  transfer_accounts: Array<{ till_id: string; bank_name: string; account_number: string; account_name: string }>;
  approvers: PosApprover[];
};

export type PosRoleView = {
  object: "pos_role";
  id: string;
  key: string | null;
  name: string;
  description: string | null;
  system: boolean;
  permissions: PermissionSet;
  discount_limit_bps: number | null;
  staff: number;
};
export type PosRoles = { object: "list"; permissions: Array<{ group: string; items: Array<{ key: PosPermission; label: string }> }>; data: PosRoleView[] };

export type PosStaffStatus = "invited" | "active" | "suspended" | "removed";
export type PosStaffMember = {
  object: "pos_staff";
  id: string;
  first_name: string;
  last_name: string;
  name: string;
  initials: string;
  phone: string;
  phone_hint: string;
  email: string | null;
  role: { id: string; key: string | null; name: string };
  all_tills: boolean;
  tills: Array<{ id: string; name: string; shop_id: string }>;
  mobile: boolean;
  status: PosStaffStatus;
  pin_set: boolean;
  locked_until: string | null;
  last_active_at: string | null;
  invited_by: string;
  created_at: string;
};
export type PosStaffList = { object: "list"; limit: number | null; used: number; data: PosStaffMember[] };
export type PosInviteSent = { url: string; expires_at: string; sent_via: "sms" | "whatsapp" | "link"; sent: boolean; message: string; whatsapp_url: string; shop_code: string | null };

export type PosInviteInfo = {
  object: "pos_invite";
  first_name: string;
  shop: { name: string | null; shop_code: string | null };
  role: { name: string; allows: string[] };
  tills: "all" | string[];
  invited_by: string;
  reset: boolean;
  expires_at: string;
};

export type PosDeviceRow = { object: "pos_device"; id: string; name: string | null; platform: string | null; till: { id: string; name: string }; linked_at: string | null; last_seen_at: string | null; revoked_at: string | null; linked_by: string };
export type PosLinkCode = { object: "pos_link_code"; device_id: string; code: string; expires_at: string; till: { id: string; name: string }; shop: string; link_url: string };
export type PosDeviceInfo = {
  object: "pos_device";
  id: string;
  name: string | null;
  shop: { id: string; name: string; shop_code: string };
  till: { id: string; name: string };
  staff: Array<{ id: string; name: string; first_name: string; initials: string; role: string; locked: boolean }>;
};

/** How a member of staff's status reads. */
export const staffStatusText: Record<PosStaffStatus, string> = { invited: "Invite pending", active: "Active", suspended: "Suspended", removed: "Removed" };

/** Where a member of staff may work, in words. */
export const accessText = (member: Pick<PosStaffMember, "all_tills" | "tills" | "mobile">) => {
  const tills = member.all_tills ? "All tills" : member.tills.map(till => till.name).join(", ") || "No till";
  return member.mobile ? `${tills}, mobile` : tills;
};

/** A permission level in the matrix's words. */
export function levelText(level: PermissionLevel) {
  if (level === "yes") return "Allowed";
  if (level === "approval") return "With approval";
  if (level === "cashiers") return "Cashiers only";
  return "Not allowed";
}

/** A discount limit in words: none, up to a share, or any amount. */
export const discountText = (bps: number | null) => (bps === null ? "Any amount" : bps === 0 ? "No discounts" : `Up to ${(bps / 100).toLocaleString("en-GB", { maximumFractionDigits: 2 })}%`);

/** Easy PINs the API refuses: all one digit, a run up or down, or a year from 1900 to 2099. */
export function weakPin(pin: string) {
  if (!/^\d{4}$/.test(pin)) return true;
  if (new Set(pin).size === 1) return true;
  const digits = [...pin].map(Number);
  const up = digits.every((digit, index) => index === 0 || digit === (digits[index - 1]! + 1) % 10);
  const down = digits.every((digit, index) => index === 0 || digit === (digits[index - 1]! + 9) % 10);
  return up || down || /^(19|20)\d\d$/.test(pin);
}

// ---- Receipts (milestone 6) ----

export type ReceiptKind = "receipt" | "invoice";

/** A receipt sent: on WhatsApp to a number, to whoever sent its QR code's words (`qr`), or by email; where to, masked. */
export type PosReceiptSend = {
  object: "pos_receipt_send";
  id: string;
  kind: ReceiptKind | "both";
  via: "whatsapp" | "qr" | "email";
  to: string;
  status: "sending" | "sent" | "delivered" | "read" | "failed";
  /** A template went in its place (outside WhatsApp's 24-hour window): they tap Get receipt to have the PDF. */
  template: boolean;
  error: string | null;
  by: string | null;
  created_at: string;
};

/** A receipt's code: the words its QR code fills in on WhatsApp, and whether the customer has had it yet. */
export type PosReceiptCode = { object: "pos_receipt_code"; id: string; kind: ReceiptKind; purpose: "screen" | "print" | "whatsapp"; expires_at: string; used_at: string | null; delivered_to: string | null; text?: string; whatsapp_url?: string | null };

/** What the receipt screen needs: how it can go, the printed QR code, the shop's details, the customer and what was sent. */
export type PosReceipts = {
  object: "pos_receipts";
  sale_id: string;
  number: string;
  invoice_number: string | null;
  whatsapp: { available: boolean; reason: string | null };
  email: { available: boolean };
  print: { width: 58 | 80; auto_print: boolean; qr: { text: string; whatsapp_url: string | null } | null };
  shop: { name: string; address: string | null; phone: string | null; tin: string | null; email: string | null; footer: string | null; online: string | null };
  customer: { id: string; name: string; phone: string | null; email: string | null } | null;
  sends: PosReceiptSend[];
};

/** How a receipt sent reads: where it went, what and how it stands. */
export function sendText(send: PosReceiptSend) {
  const what = send.kind === "both" ? "Receipt and invoice" : send.kind === "invoice" ? "Invoice" : "Receipt";
  const how = send.via === "email" ? "by email" : send.via === "qr" ? "on WhatsApp (scanned)" : "on WhatsApp";
  const state =
    send.status === "failed"
      ? `not sent${send.error ? `: ${send.error}` : ""}`
      : send.template && send.status !== "sending"
        ? "they tap Get receipt to have it"
        : { sending: "sending", sent: "sent", delivered: "delivered", read: "read" }[send.status];
  return `${what} ${how} to ${send.to}, ${state}`;
}

/** The receipt's paper widths. */
export const paperWidths = [80, 58] as const;

/** The money as a printed receipt shows it: the currency's code and two decimals, as the PDF does. */
export const receiptAmount = (minor: number) => (minor / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "Blessing M.": a cashier as receipts print them. */
export function shortName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1]![0]!.toUpperCase()}.` : (parts[0] ?? "");
}

// ---- Shifts, the overview and reports (milestone 7) ----

/** What a shift took (amounts in minor units); cash figures are null for staff who count blind. */
export type PosShiftTotals = {
  sales: number;
  sales_total: number;
  refunds: number;
  refunds_total: number;
  items: number;
  by_method: Record<string, number>;
  cash_sales: number | null;
  cash_refunds: number | null;
  paid_in: number;
  paid_out: number;
};

export type PosShift = {
  object: "pos_shift";
  id: string;
  status: "open" | "closed";
  shop_id: string;
  till: { id: string | null; name: string };
  currency: string;
  opened_at: string;
  opened_by: string;
  opening_float: number;
  closed_at: string | null;
  closed_by: string | null;
  counted_cash: number | null;
  /** The cash the drawer should hold, and counted less expected: null for staff who count blind. */
  expected_cash: number | null;
  difference: number | null;
  blind: boolean;
  totals: PosShiftTotals;
  cash: Array<{ id: string; kind: "in" | "out"; amount: number; reason: string; by: string; created_at: string }>;
  note: string | null;
};

export type PosCurrentShift = { object: "pos_current_shift"; till: { id: string; name: string }; shift: PosShift | null };
export type PosShifts = { object: "list"; currency: string; total: number; has_more: boolean; data: PosShift[] };

export type ReportPeriod = "today" | "7d" | "30d" | "custom";
type Compared = { value: number; previous: number; change_pct: number | null };

export type PosOverview = {
  object: "pos_overview";
  currency: string;
  period: ReportPeriod;
  from: string;
  to: string;
  by: "hour" | "day";
  shop: { id: string; name: string } | null;
  totals: {
    sales: Compared;
    transactions: Compared & { pos: number; online: number };
    average_basket: Compared;
    items: Compared;
    refunds: { count: number; amount: number };
    low_stock: number;
  };
  channels: { pos: { amount: number; share_pct: number }; online: { amount: number; share_pct: number } };
  series: Array<{ key: string; label: string; pos: number; online: number }>;
  busiest: { label: string; amount: number } | null;
  payment_methods: Array<{ method: string; amount: number; share_pct: number }>;
  /** Several shops: each one's sales and takings. */
  by_shop?: Array<{ shop_id: string; name: string; sales: number; total: number }>;
  top_sellers: Array<{ listing_id: string; title: string; quantity: number; revenue: number; pos_quantity: number; online_quantity: number }>;
  recent: Array<{ channel: "pos" | "online"; id: string; number: string | null; title: string; meta: string; methods: string[]; amount: number; status: string; at: string }>;
  restock: Array<{ listing_id: string; title: string; stock: number; available: number; reorder_level: number | null; per_day: number; days_left: number | null }>;
};

export type PosDay = {
  object: "pos_day";
  date: string;
  currency: string;
  shop: { id: string; name: string } | null;
  sales: { count: number; gross: number; discounts: number; vat: number; total: number; items: number };
  refunds: { count: number; total: number; by_method: Record<string, number> };
  net: number;
  by_method: Array<{ method: string; amount: number }>;
  by_till: Array<{ name: string; sales: number; total: number }>;
  by_staff: Array<{ name: string; sales: number; total: number }>;
  top_products: Array<{ title: string; quantity: number; revenue: number }>;
  shifts: PosShift[];
  online: { count: number; total: number };
};

export const reportPeriods: Array<{ value: ReportPeriod; label: string }> = [
  { value: "today", label: "Today" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "custom", label: "Custom" },
];

/** How a figure moved against the period before, in words (never colour alone): "▲ 12% vs last Tuesday". */
export function changeText(pct: number | null, against: string) {
  if (pct === null) return `Nothing to compare with ${against}`;
  if (pct === 0) return `Same as ${against}`;
  return `${pct > 0 ? "▲" : "▼"} ${Math.abs(pct)}% ${pct > 0 ? "up on" : "down on"} ${against}`;
}

/** What a period is compared with: the same weekday a week before (today), else the days just before. */
export function comparedWith(period: ReportPeriod, weekday: string) {
  if (period === "today") return `last ${weekday}, same time`;
  if (period === "7d") return "the 7 days before";
  if (period === "30d") return "the 30 days before";
  return "the days before";
}

/** A cash count against what was expected, in words: balanced, over or short. */
export function differenceText(difference: number | null, currency: string) {
  if (difference === null) return null;
  if (difference === 0) return "Balanced";
  return `${difference > 0 ? "Over" : "Short"} by ${money(Math.abs(difference), currency)}`;
}

/** Whole units typed at the till (a float, a count) as minor units, or null when it is not an amount. */
export function readCash(text: string) {
  const clean = text.replace(/[,\s₦₵]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  const minor = Math.round(Number(clean) * 100);
  return Number.isSafeInteger(minor) && minor <= 10_000_000_000 ? minor : null;
}

// ---- Several shops (milestone 8) ----

/** Stock moved between shops, or between a shop and online (`id` null). */
export type PosStockTransfer = {
  object: "pos_stock_transfer";
  id: string;
  number: string;
  from: { id: string | null; name: string };
  to: { id: string | null; name: string };
  lines: Array<{ listing_id: string; title: string; quantity: number }>;
  units: number;
  note: string | null;
  by: string;
  created_at: string;
};
export type PosStockTransfers = { object: "list"; total: number; has_more: boolean; data: PosStockTransfer[] };
