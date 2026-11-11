/**
 * Selling with no internet (docs/UDOZO_POS_PLAN.md, milestone 9): the rules the offline till follows, pure so the
 * till, its tests and the upload agree. The till keeps a copy of what it needs (`OfflineCopy`, from the API's
 * `GET /v1/pos/device/sync`), sells from it, and keeps each sale and its outbox entry until Udozo has them.
 */

import { tillTotals } from "./pos";

export type OfflinePermission = "yes" | "approval" | "no" | "cashiers";

/** What a linked till keeps to sell offline, as the API gives it. */
export type OfflineCopy = {
  object: "pos_offline_copy";
  synced_at: string;
  limits: { hours: number; sales: number; warn_hours: number };
  account: { id: string; currency: string; country: string; plan: { code: string; name: string } };
  shop: {
    id: string;
    name: string;
    address: string | null;
    phone: string | null;
    tin: string | null;
    email: string | null;
    shop_code: string;
    vat_bps: number;
    receipt_footer: string | null;
    receipt_qr: boolean;
    bank: { name: string | null; account_name: string | null; account_number: string | null } | null;
    paused: boolean;
    closed: boolean;
  };
  till: { id: string; name: string; printer_width: number; auto_print: boolean };
  payment_methods: readonly string[];
  staff: Array<{ id: string; name: string; first_name: string; initials: string; role: { id: string | null; name: string; discount_limit_bps: number | null }; permissions: Record<string, OfflinePermission> }>;
  categories: Array<{ id: string; name: string; count: number; featured: boolean }>;
  products: OfflineProduct[];
};

export type OfflineProduct = {
  id: string;
  ref: number;
  sku: string | null;
  title: string | null;
  barcode: string | null;
  price: number | null;
  category: { id: string; name: string; parent: { id: string; name: string } | null } | null;
  photo_url: string | null;
  /** Free to sell at this till's shop when the copy was made. */
  available: number;
  blocked: string | null;
};

export type OfflinePaymentMethod = "cash" | "transfer" | "card" | "other";
export type OfflineLine = { listing_id: string; title: string; quantity: number; unit_price: number };
export type OfflinePayment = { method: OfflinePaymentMethod; amount: number; tendered: number | null; reference: string | null };

/** A sale rung up offline, kept on the device until Udozo has it (and 30 days after, to reprint). */
export type LocalSale = {
  client_sale_id: string;
  client_number: string;
  created_at: string;
  staff_id: string;
  staff_name: string;
  approved_by_staff_id: string | null;
  lines: OfflineLine[];
  discount: number;
  vat_bps: number;
  subtotal: number;
  vat: number;
  total: number;
  change: number;
  payments: OfflinePayment[];
  /** `waiting` to upload, `uploaded` (with its POS- number), `flagged` (uploaded, with something to look at) or `failed` (refused). */
  status: "waiting" | "uploaded" | "flagged" | "failed";
  number: string | null;
  error: string | null;
};

/** The device's own bookkeeping: when it last synced, the next provisional number, sales made since the last sync. */
export type OfflineMeta = { synced_at: string | null; next_number: number; offline_sales: number };

export type OfflineState = { canSell: true; warn: string | null } | { canSell: false; reason: string };

const hourMs = 3_600_000;

/**
 * Whether the till may sell offline now: it has synced, its shop sells, and it is within the limits (72 hours since it
 * last synced, 500 sales made offline), warning from 48 hours. After that it stops until it is back online.
 */
export function offlineState(copy: Pick<OfflineCopy, "limits" | "shop" | "synced_at"> | null, meta: OfflineMeta, now = Date.now()): OfflineState {
  if (!copy) return { canSell: false, reason: "This till has never been online with the shop. Connect it to the internet once to sell offline." };
  if (copy.shop.closed) return { canSell: false, reason: `${copy.shop.name} is closed.` };
  if (copy.shop.paused) return { canSell: false, reason: `${copy.shop.name} is paused on your plan.` };
  const hours = (now - new Date(copy.synced_at).getTime()) / hourMs;
  if (hours >= copy.limits.hours) return { canSell: false, reason: `This till has been offline for more than ${copy.limits.hours} hours. Connect it to the internet to carry on selling.` };
  if (meta.offline_sales >= copy.limits.sales) return { canSell: false, reason: `This till has made ${copy.limits.sales} sales offline. Connect it to the internet to upload them before selling more.` };
  if (hours >= copy.limits.warn_hours) return { canSell: true, warn: `Offline for ${Math.floor(hours)} hours: selling stops at ${copy.limits.hours}. Connect to the internet soon.` };
  return { canSell: true, warn: null };
}

/** The till's tag on provisional numbers: the number in its name ("Till 2" is T2), else T1. */
export const tillTag = (name: string) => `T${name.match(/\d+/)?.[0] ?? "1"}`;

/** A provisional receipt number naming the till, `T2-0042`, replaced by its POS- number on upload. */
export const provisionalNumber = (tillName: string, n: number) => `${tillTag(tillName)}-${String(n).padStart(4, "0")}`;

/** What is free to sell of a product now: the copy's figure less what this till sold offline since. */
export const freeNow = (product: Pick<OfflineProduct, "id" | "available">, soldHere: ReadonlyMap<string, number>) => Math.max(0, product.available - (soldHere.get(product.id) ?? 0));

/** Units of each product sold offline and not yet uploaded. */
export function soldSince(sales: readonly Pick<LocalSale, "status" | "lines">[]) {
  const sold = new Map<string, number>();
  for (const sale of sales) {
    if (sale.status !== "waiting") continue;
    for (const line of sale.lines) sold.set(line.listing_id, (sold.get(line.listing_id) ?? 0) + line.quantity);
  }
  return sold;
}

/** Whether a member of staff may sell offline, and their discount limit there (a manager's PIN lifts it, as online). */
export const maySell = (person: Pick<OfflineCopy["staff"][number], "permissions">) => person.permissions.sell === "yes";

/**
 * Makes a sale from the basket, checked as Udozo will check it: the totals from the prices sold at, and recorded
 * payments (cash, transfer to the shop, card, other) adding up to the total, cash giving change.
 */
export function makeSale(input: {
  client_sale_id: string;
  client_number: string;
  now: Date;
  staff: { id: string; name: string };
  approved_by_staff_id?: string | null;
  lines: OfflineLine[];
  discount: number;
  vat_bps: number;
  payments: OfflinePayment[];
}): { ok: true; sale: LocalSale } | { ok: false; message: string } {
  if (!input.lines.length) return { ok: false, message: "Add something to the basket first." };
  const totals = tillTotals(
    input.lines.map(line => ({ id: line.listing_id, unit: line.unit_price, quantity: line.quantity })),
    { discount: input.discount, vatBps: input.vat_bps },
  );
  let paid = 0;
  let change = 0;
  for (const payment of input.payments) {
    if (!["cash", "transfer", "card", "other"].includes(payment.method)) return { ok: false, message: "Offline, take cash, card, a transfer to the shop or another recorded payment." };
    if (!Number.isSafeInteger(payment.amount) || payment.amount <= 0) return { ok: false, message: "Each payment is above nothing." };
    paid += payment.amount;
    if (payment.method === "cash" && payment.tendered !== null) {
      if (payment.tendered < payment.amount) return { ok: false, message: "The cash handed over does not cover the cash part." };
      change += payment.tendered - payment.amount;
    }
  }
  if (paid !== totals.total) return { ok: false, message: paid < totals.total ? "The payments do not cover the total yet." : "The payments add up to more than the total." };
  return {
    ok: true,
    sale: {
      client_sale_id: input.client_sale_id,
      client_number: input.client_number,
      created_at: input.now.toISOString(),
      staff_id: input.staff.id,
      staff_name: input.staff.name,
      approved_by_staff_id: input.approved_by_staff_id ?? null,
      lines: input.lines,
      discount: totals.discount,
      vat_bps: input.vat_bps,
      subtotal: totals.subtotal,
      vat: totals.vat,
      total: totals.total,
      change,
      payments: input.payments,
      status: "waiting",
      number: null,
      error: null,
    },
  };
}

/** A sale as the API's upload takes it. */
export function uploadEntry(sale: LocalSale) {
  return {
    kind: "sale" as const,
    client_sale_id: sale.client_sale_id,
    client_number: sale.client_number,
    client_created_at: sale.created_at,
    staff_id: sale.staff_id,
    ...(sale.approved_by_staff_id ? { approved_by_staff_id: sale.approved_by_staff_id } : {}),
    lines: sale.lines.map(line => ({ listing_id: line.listing_id, quantity: line.quantity, unit_price: line.unit_price })),
    ...(sale.discount ? { discount: sale.discount } : {}),
    vat_bps: sale.vat_bps,
    payments: sale.payments.map(payment => ({ method: payment.method, amount: payment.amount, ...(payment.tendered !== null ? { tendered: payment.tendered } : {}), ...(payment.reference ? { reference: payment.reference } : {}) })),
    total: sale.total,
  };
}

export type UploadResult = { client_id: string; status: "applied" | "duplicate" | "held" | "rejected"; sale?: { number: string; flags: unknown[] }; error?: { code: string; message: string } };

/** A local sale after Udozo answered for it. */
export function afterUpload(sale: LocalSale, result: UploadResult): LocalSale {
  if (result.status === "rejected") return { ...sale, status: "failed", error: result.error?.message ?? "Udozo refused this sale." };
  if (result.status === "held") return { ...sale, status: "uploaded", error: "Held for the shop owner: this device was unlinked." };
  const flagged = (result.sale?.flags?.length ?? 0) > 0;
  return { ...sale, status: flagged ? "flagged" : "uploaded", number: result.sale?.number ?? sale.number, error: null };
}

/** Sales kept on the device after upload, to reprint: 30 days. */
export const keepUploadedDays = 30;
export const expired = (sale: Pick<LocalSale, "status" | "created_at">, now = Date.now()) => sale.status !== "waiting" && now - new Date(sale.created_at).getTime() > keepUploadedDays * 86_400_000;
