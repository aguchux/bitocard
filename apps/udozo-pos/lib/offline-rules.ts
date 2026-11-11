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
  /** The limits on this till's plan, set by Udozo's admins. */
  limits: { hours: number; sales: number; warn_hours: number };
  /** This device; `key` is whether Udozo has its signing key (for a file of unsent sales). */
  device?: { id: string; key: boolean };
  /** The till's shift open when the copy was made. */
  shift?: { id: string; client_id: string | null; opened_at: string; opened_by: string; opening_float: number } | null;
  /** This till's latest sales (7 days), to refund offline. */
  recent_sales?: RecentSale[];
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
  /** On the shelf at this shop when the copy was made, for counts. */
  on_hand?: number;
  blocked: string | null;
};

/** One of this till's sales from Udozo, as the copy carries it. */
export type RecentSale = {
  id: string;
  client_sale_id: string | null;
  number: string;
  client_number: string | null;
  created_at: string;
  sold_by: string;
  total: number;
  lines: Array<{ listing_id: string; title: string; quantity: number; unit_price: number }>;
  payments: Array<{ method: string; amount: number }>;
  refundable_offline: boolean;
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
  /** Receipts to send once the sale reaches Udozo. */
  receipt?: { whatsapp: string | null; email: string | null } | null;
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
  receipt?: { whatsapp: string | null; email: string | null } | null;
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
      receipt: input.receipt?.whatsapp || input.receipt?.email ? input.receipt : null,
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
    ...(sale.receipt ? { receipt: sale.receipt } : {}),
  };
}

export type UploadResult = { client_id: string; status: "applied" | "duplicate" | "held" | "rejected"; sale?: { number: string; flags: unknown[] }; error?: { code: string; message: string } };

// ---- Shifts, refunds and stock changes made offline ----

export type EntryKind = "refund" | "shift_open" | "shift_cash" | "shift_close" | "stock";

/** A step other than a sale, kept on the device until Udozo has it (uploaded in time order with the sales). */
export type OutboxEntry = {
  client_id: string;
  kind: EntryKind;
  created_at: string;
  /** What the till shows for it ("Shift opened by Bola", "Refund of T1-0004"). */
  label: string;
  /** The entry exactly as the upload takes it. */
  entry: Record<string, unknown>;
  status: "waiting" | "uploaded" | "failed";
  error: string | null;
};

export const newEntry = (kind: EntryKind, label: string, entry: Record<string, unknown>, now = new Date()): OutboxEntry => {
  const client_id = String(entry.client_id);
  return { client_id, kind, created_at: now.toISOString(), label, entry: { kind, ...entry, client_id }, status: "waiting", error: null };
};

export function afterEntryUpload(entry: OutboxEntry, result: UploadResult): OutboxEntry {
  if (result.status === "rejected") return { ...entry, status: "failed", error: result.error?.message ?? "Udozo refused this." };
  return { ...entry, status: "uploaded", error: null };
}

/** Sales and other steps waiting, in the order they happened (the order they are uploaded in). */
export function pendingUpload(sales: readonly LocalSale[], entries: readonly OutboxEntry[]) {
  const rows = [
    ...sales.filter(sale => sale.status === "waiting").map(sale => ({ at: sale.created_at, id: sale.client_sale_id, body: uploadEntry(sale) as Record<string, unknown> })),
    ...entries.filter(entry => entry.status === "waiting").map(entry => ({ at: entry.created_at, id: entry.client_id, body: entry.entry })),
  ];
  return rows.sort((a, b) => a.at.localeCompare(b.at));
}

/** The till's shift as it stands on the device: opened online (`id`) or offline (`client_id`), with cash moved since. */
export type LocalShift = { id: string | null; client_id: string | null; opened_at: string; opened_by: string; opening_float: number; cash: Array<{ kind: "in" | "out"; amount: number }> };

/** Cash the drawer should hold: the float, cash taken for sales made here since the shift opened and cash in, less cash out and cash refunded. */
export function expectedCash(shift: LocalShift, sales: readonly LocalSale[], refundedCash = 0) {
  let cash = shift.opening_float;
  for (const sale of sales) {
    if (sale.status === "failed" || sale.created_at < shift.opened_at) continue;
    for (const payment of sale.payments) if (payment.method === "cash") cash += payment.amount;
  }
  for (const move of shift.cash) cash += move.kind === "in" ? move.amount : -move.amount;
  return cash - refundedCash;
}

type Person = OfflineCopy["staff"][number];
export const level = (person: Pick<Person, "permissions">, permission: string): OfflinePermission => person.permissions[permission] ?? "no";
/** Opens, counts and closes the till: the till or cash-up permission. */
export const mayRunShift = (person: Pick<Person, "permissions">) => level(person, "till") === "yes" || level(person, "cash_up") === "yes";
/** Counts blind (without being told what the drawer should hold) unless they may cash up. */
export const countsBlind = (person: Pick<Person, "permissions">) => level(person, "cash_up") !== "yes";

/** What a manager's PIN is for: a bigger discount (its share in basis points), selling past the copy's stock, a refund or a stock change. */
export type ApprovalNeed = { kind: "discount"; bps: number } | { kind: "oversell" } | { kind: "refund" } | { kind: "stock" };

/** Colleagues whose PIN this till can check and whose own role covers what is asked. */
export function approversFor(staff: readonly Person[], checks: ReadonlySet<string>, need: ApprovalNeed, asking: string) {
  return staff.filter(person => {
    if (person.id === asking || !checks.has(person.id)) return false;
    switch (need.kind) {
      case "discount":
        return level(person, "sell") === "yes" && (person.role.discount_limit_bps === null || need.bps <= person.role.discount_limit_bps);
      case "oversell":
      case "stock":
        return level(person, "stock_adjust") === "yes";
      case "refund":
        return level(person, "refund") === "yes";
    }
  });
}

/** A discount's share of the subtotal in basis points, rounded up as Udozo works it out. */
export const shareBps = (discount: number, subtotal: number) => (subtotal > 0 ? Math.ceil((discount * 10_000) / subtotal) : 0);

/** A sale this till may refund offline: one made here offline, or one from Udozo paid in ways the shop handles. */
export type Refundable = { client_sale_id: string; number: string; created_at: string; total: number; lines: OfflineLine[]; cash: number };
const cashOf = (payments: ReadonlyArray<{ method: string; amount: number }>) => payments.filter(payment => payment.method === "cash").reduce((sum, payment) => sum + payment.amount, 0);
export function refundables(sales: readonly LocalSale[], recent: readonly RecentSale[], refunded: ReadonlySet<string>): Refundable[] {
  const rows = new Map<string, Refundable>();
  for (const sale of recent) {
    if (!sale.client_sale_id || !sale.refundable_offline || refunded.has(sale.client_sale_id)) continue;
    rows.set(sale.client_sale_id, { client_sale_id: sale.client_sale_id, number: sale.number, created_at: sale.created_at, total: sale.total, lines: sale.lines, cash: cashOf(sale.payments) });
  }
  for (const sale of sales) {
    if (sale.status === "failed" || refunded.has(sale.client_sale_id)) continue;
    rows.set(sale.client_sale_id, { client_sale_id: sale.client_sale_id, number: sale.number ?? sale.client_number, created_at: sale.created_at, total: sale.total, lines: sale.lines, cash: cashOf(sale.payments) });
  }
  return [...rows.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/** The file of unsent entries a till saves: what is signed (`payload`) names the device. */
export const exportPayload = (deviceId: string, entries: readonly Record<string, unknown>[], now = new Date()) => JSON.stringify({ object: "pos_offline_export", device_id: deviceId, made_at: now.toISOString(), entries });

/** A local sale after Udozo answered for it. */
export function afterUpload(sale: LocalSale, result: UploadResult): LocalSale {
  if (result.status === "rejected") return { ...sale, status: "failed", error: result.error?.message ?? "Udozo refused this sale." };
  if (result.status === "held") return { ...sale, status: "uploaded", error: "Held for the shop owner: this device was unlinked." };
  const flagged = (result.sale?.flags?.length ?? 0) > 0;
  return { ...sale, status: flagged ? "flagged" : "uploaded", number: result.sale?.number ?? sale.number, error: null };
}

/** Sales kept on the device after upload, to reprint: 30 days. */
export const keepUploadedDays = 30;
export const expired = (sale: { status: string; created_at: string }, now = Date.now()) => sale.status !== "waiting" && now - new Date(sale.created_at).getTime() > keepUploadedDays * 86_400_000;
