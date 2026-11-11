"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { type PosAccount, type PosPaymentMethod, type PosPlan, type PosSale, type PosStockMovement, type PosWalletRequest, paymentMethods, planOrder } from "./pos";
import { type ApiResult, customerApi, dropSession } from "./session";

/** What an action answers: the account as it now is, or Udozo's refusal in words with the field it names. */
export type PosResult<T> = { ok: true; data: T } | { ok: false; message: string; code: string | null; param: string | null };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const refused = (message: string, param: string | null = null, code: string | null = "parameter_invalid"): PosResult<never> => ({ ok: false, message, code, param });

function answer<T>(result: ApiResult<T>): PosResult<T> {
  if (!result.ok) return { ok: false, message: result.status === 401 ? "Your session ended. Sign in again to carry on." : result.message, code: result.code, param: result.param };
  revalidatePath("/app", "layout");
  return { ok: true, data: result.data };
}

export type ShopFields = { name?: string; address?: string | null; phone?: string | null; tin?: string | null; vat_bps?: number; receipt_footer?: string | null; kind?: string };

const text = (value: string | null | undefined, max: number) => (value === null || value === undefined ? value : value.trim().slice(0, max) || null);

function shopBody(fields: ShopFields) {
  if (fields.vat_bps !== undefined && (!Number.isInteger(fields.vat_bps) || fields.vat_bps < 0 || fields.vat_bps > 5000)) return null;
  return {
    ...(fields.name !== undefined ? { name: fields.name.trim().slice(0, 80) } : {}),
    ...(fields.address !== undefined ? { address: text(fields.address, 300) } : {}),
    ...(fields.phone !== undefined ? { phone: text(fields.phone, 30) } : {}),
    ...(fields.tin !== undefined ? { tin: text(fields.tin, 40) } : {}),
    ...(fields.vat_bps !== undefined ? { vat_bps: fields.vat_bps } : {}),
    ...(fields.receipt_footer !== undefined ? { receipt_footer: text(fields.receipt_footer, 300) } : {}),
    ...(fields.kind !== undefined && /^[a-z_]{1,32}$/.test(fields.kind) ? { kind: fields.kind } : {}),
  };
}

const isPlan = (code: string): code is PosPlan["code"] => (planOrder as string[]).includes(code);

/**
 * Signing up: the shop, its first till and the plan. `expected` is what the owner was shown due today (minor units),
 * so a price that moved meanwhile is refused (`price_changed`) instead of taken.
 */
export async function signUp(plan: string, shop: ShopFields, expected: number): Promise<PosResult<PosAccount>> {
  if (!isPlan(plan)) return refused("Choose a plan.", "plan");
  if (!shop.name?.trim()) return refused("Give your shop's name.", "shop.name", "parameter_missing");
  if (!Number.isSafeInteger(expected) || expected < 0) return refused("Choose a plan.", "plan");
  const body = shopBody(shop);
  if (!body) return refused("VAT is from 0% to 50%.", "vat_bps");
  return answer(await customerApi<PosAccount>("POST", "/v1/pos/owner/signup", { plan, shop: body, expected_amount: expected }));
}

/** Moving to another plan: dearer ones are charged now (less what is unused), cheaper ones from the month's end. */
export async function changePlan(plan: string): Promise<PosResult<PosAccount>> {
  if (!isPlan(plan)) return refused("Choose a plan.", "plan");
  return answer(await customerApi<PosAccount>("POST", "/v1/pos/owner/plan", { plan }));
}

export async function updateShop(id: string, fields: ShopFields): Promise<PosResult<PosAccount>> {
  if (!uuid.test(id)) return refused("No such shop.", null, "resource_missing");
  if (fields.name !== undefined && !fields.name.trim()) return refused("Give your shop's name.", "name", "parameter_missing");
  const body = shopBody(fields);
  if (!body) return refused("VAT is from 0% to 50%.", "vat_bps");
  return answer(await customerApi<PosAccount>("PATCH", `/v1/pos/owner/shops/${id}`, body));
}

export async function addTill(shopId: string, name: string): Promise<PosResult<PosAccount>> {
  if (!uuid.test(shopId)) return refused("No such shop.", null, "resource_missing");
  const clean = name.trim().slice(0, 60);
  return answer(await customerApi<PosAccount>("POST", `/v1/pos/owner/shops/${shopId}/tills`, clean ? { name: clean } : {}));
}

export async function updateTill(id: string, fields: { name?: string; printer_width?: 58 | 80; auto_print?: boolean }): Promise<PosResult<PosAccount>> {
  if (!uuid.test(id)) return refused("No such till.", null, "resource_missing");
  if (fields.name !== undefined && !fields.name.trim()) return refused("Give the till a name.", "name", "parameter_missing");
  if (fields.printer_width !== undefined && fields.printer_width !== 58 && fields.printer_width !== 80) return refused("Receipts are 58 mm or 80 mm wide.", "printer_width");
  const body = { ...(fields.name !== undefined ? { name: fields.name.trim().slice(0, 60) } : {}), ...(fields.printer_width ? { printer_width: fields.printer_width } : {}), ...(fields.auto_print !== undefined ? { auto_print: fields.auto_print } : {}) };
  return answer(await customerApi<PosAccount>("PATCH", `/v1/pos/owner/tills/${id}`, body));
}

export async function removeTill(id: string): Promise<PosResult<PosAccount>> {
  if (!uuid.test(id)) return refused("No such till.", null, "resource_missing");
  return answer(await customerApi<PosAccount>("DELETE", `/v1/pos/owner/tills/${id}`));
}

export type RingUp = {
  till_id: string;
  /** Made by the till for this basket and kept until it goes through, so sending it again is one sale. */
  client_sale_id: string;
  lines: Array<{ listing_id: string; quantity: number; discount?: number }>;
  discount?: number;
  payments: Array<{ method: PosPaymentMethod; amount: number; tendered?: number | null; reference?: string | null }>;
  expected_total: number;
  note?: string | null;
};

const whole = (value: unknown, min = 0) => typeof value === "number" && Number.isSafeInteger(value) && value >= min;

/** Rings up a sale at the till. The units come off the listings' stock; payment is recorded, never taken by Udozo. */
export async function ringUp(sale: RingUp): Promise<PosResult<PosSale>> {
  if (!uuid.test(sale.till_id)) return refused("Choose a till.", "till_id", "resource_missing");
  if (!uuid.test(sale.client_sale_id)) return refused("Start a new sale.", "client_sale_id");
  if (!sale.lines.length || sale.lines.length > 100 || sale.lines.some(line => !uuid.test(line.listing_id) || !whole(line.quantity, 1) || (line.discount !== undefined && !whole(line.discount)))) return refused("Add products to the sale.", "lines");
  if (sale.payments.length > 5 || sale.payments.some(payment => !paymentMethods.some(item => item.value === payment.method) || !whole(payment.amount, 1) || (payment.tendered != null && !whole(payment.tendered, 1)))) return refused("Record how it was paid.", "payments");
  if (!whole(sale.expected_total) || (sale.discount !== undefined && !whole(sale.discount))) return refused("Check the total.", "expected_total");
  const body = {
    till_id: sale.till_id,
    client_sale_id: sale.client_sale_id,
    lines: sale.lines.map(line => ({ listing_id: line.listing_id, quantity: line.quantity, ...(line.discount ? { discount: line.discount } : {}) })),
    ...(sale.discount ? { discount: sale.discount } : {}),
    payments: sale.payments.map(payment => ({ method: payment.method, amount: payment.amount, ...(payment.method === "cash" && payment.tendered ? { tendered: payment.tendered } : {}), ...(payment.reference?.trim() ? { reference: payment.reference.trim().slice(0, 80) } : {}) })),
    expected_total: sale.expected_total,
    ...(sale.note?.trim() ? { note: sale.note.trim().slice(0, 300) } : {}),
  };
  // The basket's own id is the idempotency key too, so a send that lost its reply is never a second sale.
  return answer(await customerApi<PosSale>("POST", "/v1/pos/owner/sales", body, { idempotencyKey: `sale-${sale.client_sale_id}` }));
}

/** Refunds a whole sale (the shop pays it back as it was paid), putting its units back unless `restock` is false. */
export async function refundSale(id: string, reason: string, restock = true): Promise<PosResult<PosSale>> {
  if (!uuid.test(id)) return refused("No such sale.", null, "resource_missing");
  if (!reason.trim()) return refused("Say why it is refunded.", "reason", "parameter_missing");
  return answer(await customerApi<PosSale>("POST", `/v1/pos/owner/sales/${id}/refund`, { reason: reason.trim().slice(0, 300), restock }));
}

/**
 * Asks the buyer to pay the rest of the basket from their Udozo wallet: a QR code for whoever signs in on udozo.com to
 * pay, or, with `phone`, a request to that buyer. Nothing is taken until they press Pay there.
 */
export async function askWallet(sale: RingUp & { wallet_amount: number; phone?: string }): Promise<PosResult<PosWalletRequest & { token: string; pay_url: string }>> {
  if (!uuid.test(sale.till_id) || !uuid.test(sale.client_sale_id)) return refused("Start a new sale.", "client_sale_id");
  if (!sale.lines.length || sale.lines.some(line => !uuid.test(line.listing_id) || !whole(line.quantity, 1))) return refused("Add products to the sale.", "lines");
  if (!whole(sale.wallet_amount, 1) || !whole(sale.expected_total)) return refused("Check the total.", "wallet_amount");
  const phone = sale.phone?.replace(/[\s-]/g, "") ?? "";
  if (phone && !/^\+\d{8,15}$/.test(phone)) return refused("Give the buyer's number with its country code, like +234 803 000 0000.", "phone");
  const body = {
    till_id: sale.till_id,
    client_sale_id: sale.client_sale_id,
    lines: sale.lines.map(line => ({ listing_id: line.listing_id, quantity: line.quantity })),
    ...(sale.discount ? { discount: sale.discount } : {}),
    payments: sale.payments.map(payment => ({ method: payment.method, amount: payment.amount, ...(payment.method === "cash" && payment.tendered ? { tendered: payment.tendered } : {}), ...(payment.reference?.trim() ? { reference: payment.reference.trim().slice(0, 80) } : {}) })),
    wallet_amount: sale.wallet_amount,
    expected_total: sale.expected_total,
    ...(phone ? { phone } : {}),
  };
  const result = await customerApi<PosWalletRequest & { token: string; pay_url: string }>("POST", "/v1/pos/owner/wallet-requests", body);
  return result.ok ? { ok: true, data: result.data } : { ok: false, message: result.status === 401 ? "Your session ended. Sign in again to carry on." : result.message, code: result.code, param: result.param };
}

/** Where a wallet request stands; once paid, it carries the sale. */
export async function walletStatus(id: string): Promise<PosResult<PosWalletRequest>> {
  if (!uuid.test(id)) return refused("No such request.", null, "resource_missing");
  const result = await customerApi<PosWalletRequest>("GET", `/v1/pos/owner/wallet-requests/${id}`);
  if (!result.ok) return { ok: false, message: result.message, code: result.code, param: result.param };
  if (result.data.status === "paid") revalidatePath("/app", "layout");
  return { ok: true, data: result.data };
}

export async function cancelWallet(id: string): Promise<PosResult<PosWalletRequest>> {
  if (!uuid.test(id)) return refused("No such request.", null, "resource_missing");
  const result = await customerApi<PosWalletRequest>("POST", `/v1/pos/owner/wallet-requests/${id}/cancel`);
  return result.ok ? { ok: true, data: result.data } : { ok: false, message: result.message, code: result.code, param: result.param };
}

export type StockKind = "restock" | "count" | "damage";
export type StockAnswer = { object: "pos_stock"; listing_id: string; stock: number; held: number; available: number; movement: PosStockMovement };

/** Restocks, counts or writes off a product's units. */
export async function adjustStock(listingId: string, kind: StockKind, quantity: number, note = ""): Promise<PosResult<StockAnswer>> {
  if (!uuid.test(listingId)) return refused("No such product.", null, "resource_missing");
  if (!["restock", "count", "damage"].includes(kind)) return refused("Choose what happened.", "kind");
  if (!whole(quantity, kind === "count" ? 0 : 1) || quantity > 100_000) return refused(kind === "count" ? "Count what is on the shelf: 0 or more." : "Give how many, from 1.", "quantity");
  return answer(await customerApi<StockAnswer>("POST", `/v1/pos/owner/stock/${listingId}`, { kind, quantity, ...(note.trim() ? { note: note.trim().slice(0, 200) } : {}) }));
}

/** A product's latest stock movements, newest first. */
export async function stockHistory(listingId: string): Promise<PosResult<PosStockMovement[]>> {
  if (!uuid.test(listingId)) return refused("No such product.", null, "resource_missing");
  const result = await customerApi<{ data: PosStockMovement[] }>("GET", `/v1/pos/owner/stock/${listingId}/movements`);
  return result.ok ? { ok: true, data: result.data.data } : { ok: false, message: result.status === 401 ? "Your session ended. Sign in again to carry on." : result.message, code: result.code, param: result.param };
}

/** Signing out of pos.udozo.com only: udozo.com keeps its own session. */
export async function signOut() {
  await customerApi("POST", "/v1/store/account/signout");
  await dropSession();
  redirect("/");
}
