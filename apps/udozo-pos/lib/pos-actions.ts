"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { type BillingInterval, type PosAccount, type PosCollection, type PosCollectionAccount, type PosCollectionsOverview, type PosCustomer, type PosCustomerBrief, type PosCustomers, type PosPaymentMethod, type PosPlan, type PosSale, type PosStockMovement, type PosStockTransfer, type PosTransferRequest, type PosShopPrices, type PosFlaggedSale, type PosOfflineHeld, type PosWalletRequest, paymentMethods, planOrder } from "./pos";
import { type ApiResult, customerApi, dropSession, dropStaffSession } from "./session";
import { posApi } from "./pos-api";

/** What an action answers: the account as it now is, or Udozo's refusal in words with the field it names. */
export type PosResult<T> = { ok: true; data: T } | { ok: false; message: string; code: string | null; param: string | null };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const refused = (message: string, param: string | null = null, code: string | null = "parameter_invalid"): PosResult<never> => ({ ok: false, message, code, param });

function answer<T>(result: ApiResult<T>): PosResult<T> {
  if (!result.ok) return { ok: false, message: result.status === 401 ? "Your session ended. Sign in again to carry on." : result.message, code: result.code, param: result.param };
  revalidatePath("/app", "layout");
  return { ok: true, data: result.data };
}

export type ShopFields = {
  name?: string;
  address?: string | null;
  phone?: string | null;
  tin?: string | null;
  vat_bps?: number;
  receipt_footer?: string | null;
  kind?: string;
  email?: string | null;
  bank_name?: string | null;
  bank_account_name?: string | null;
  bank_account_number?: string | null;
  receipt_qr?: boolean;
};

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
    ...(fields.email !== undefined ? { email: text(fields.email, 254) } : {}),
    ...(fields.bank_name !== undefined ? { bank_name: text(fields.bank_name, 80) } : {}),
    ...(fields.bank_account_name !== undefined ? { bank_account_name: text(fields.bank_account_name, 120) } : {}),
    ...(fields.bank_account_number !== undefined ? { bank_account_number: text(fields.bank_account_number, 30) } : {}),
    ...(fields.receipt_qr !== undefined ? { receipt_qr: fields.receipt_qr === true } : {}),
  };
}

const isPlan = (code: string): code is PosPlan["code"] => (planOrder as string[]).includes(code);

/**
 * Signing up: the shop, its first till and the plan. `expected` is what the owner was shown due today (minor units),
 * so a price that moved meanwhile is refused (`price_changed`) instead of taken.
 */
export async function signUp(plan: string, shop: ShopFields, expected: number, interval: BillingInterval = "month"): Promise<PosResult<PosAccount>> {
  if (!isPlan(plan)) return refused("Choose a plan.", "plan");
  if (!shop.name?.trim()) return refused("Give your shop's name.", "shop.name", "parameter_missing");
  if (!Number.isSafeInteger(expected) || expected < 0) return refused("Choose a plan.", "plan");
  const body = shopBody(shop);
  if (!body) return refused("VAT is from 0% to 50%.", "vat_bps");
  return answer(await customerApi<PosAccount>("POST", "/v1/pos/owner/signup", { plan, shop: body, expected_amount: expected, ...(interval === "year" ? { interval } : {}) }));
}

/** Moving to another plan: dearer ones are charged now (less what is unused), cheaper ones from the month's end. */
export async function changePlan(plan: string, interval?: BillingInterval): Promise<PosResult<PosAccount>> {
  if (!isPlan(plan)) return refused("Choose a plan.", "plan");
  if (interval !== undefined && interval !== "month" && interval !== "year") return refused("Choose monthly or yearly.", "interval");
  return answer(await customerApi<PosAccount>("POST", "/v1/pos/owner/plan", { plan, ...(interval ? { interval } : {}) }));
}

/** Opens another shop (within the plan's shop limit): from the second, stock is split between the shops. */
export async function addShop(name: string): Promise<PosResult<PosAccount>> {
  if (!name.trim()) return refused("Give the shop's name.", "name", "parameter_missing");
  return answer(await customerApi<PosAccount>("POST", "/v1/pos/owner/shops", { name: name.trim().slice(0, 80) }));
}

/** The owner's choices for a shop: first in the list (main), or the one online orders take from. */
export async function chooseShop(id: string, choice: "main" | "fulfils_online"): Promise<PosResult<PosAccount>> {
  if (!uuid.test(id)) return refused("No such shop.", null, "resource_missing");
  return answer(await customerApi<PosAccount>("PATCH", `/v1/pos/owner/shops/${id}`, { [choice]: true }));
}

/** Moves stock between shops, or between a shop and online (null). */
export async function moveStock(input: { from: string | null; to: string | null; lines: Array<{ listing_id: string; quantity: number }>; note?: string; inTransit?: boolean }): Promise<PosResult<PosStockTransfer>> {
  if ((input.from !== null && !uuid.test(input.from)) || (input.to !== null && !uuid.test(input.to))) return refused("Choose where it leaves and where it goes.", "to_shop_id");
  if (input.from === input.to) return refused("Choose two different places.", "to_shop_id");
  if (!input.lines.length || input.lines.some(line => !uuid.test(line.listing_id) || !Number.isSafeInteger(line.quantity) || line.quantity < 1)) return refused("Choose the products and how many of each.", "lines");
  return answer(await posApi<PosStockTransfer>("POST", "/stock-transfers", { from_shop_id: input.from, to_shop_id: input.to, lines: input.lines, ...(input.note?.trim() ? { note: input.note.trim().slice(0, 300) } : {}), ...(input.inTransit && input.from && input.to ? { in_transit: true } : {}) }));
}

/** The receiving shop checks a transfer in: what arrived of each line (a line left out arrived in full). */
export async function receiveStock(id: string, lines: Array<{ listing_id: string; quantity: number }> = [], note = ""): Promise<PosResult<PosStockTransfer>> {
  if (!uuid.test(id)) return refused("No such transfer.", null, "resource_missing");
  if (lines.some(line => !uuid.test(line.listing_id) || !Number.isSafeInteger(line.quantity) || line.quantity < 0)) return refused("Say how many of each arrived.", "lines");
  return answer(await posApi<PosStockTransfer>("POST", `/stock-transfers/${id}/receive`, { ...(lines.length ? { lines } : {}), ...(note.trim() ? { note: note.trim().slice(0, 200) } : {}) }));
}

/** The sender takes stock still on its way back. */
export async function takeBackStock(id: string): Promise<PosResult<PosStockTransfer>> {
  if (!uuid.test(id)) return refused("No such transfer.", null, "resource_missing");
  return answer(await posApi<PosStockTransfer>("POST", `/stock-transfers/${id}/cancel`));
}

/** Closes a shop, its stock moved to another shop or online (`null`). The owner's alone. */
export async function closeShop(id: string, moveTo: string | null): Promise<PosResult<PosAccount>> {
  if (!uuid.test(id) || (moveTo !== null && !uuid.test(moveTo))) return refused("Choose where its stock goes.", "move_to_shop_id");
  return answer(await customerApi<PosAccount>("POST", `/v1/pos/owner/shops/${id}/close`, { move_to_shop_id: moveTo }));
}

/** A shop's own price for a product (minor units), or `null` to go back to the listing's. */
export async function setShopPrice(listingId: string, shopId: string, price: number | null): Promise<PosResult<PosShopPrices>> {
  if (!uuid.test(listingId) || !uuid.test(shopId)) return refused("Choose the shop.", "shop_id");
  if (price !== null && (!Number.isSafeInteger(price) || price < 1)) return refused("Give a price above nothing.", "price");
  return answer(await posApi<PosShopPrices>("PUT", `/products/${listingId}/prices`, { shop_id: shopId, price }));
}

export async function shopPrices(listingId: string): Promise<PosResult<PosShopPrices>> {
  if (!uuid.test(listingId)) return refused("No such product.", null, "resource_missing");
  const result = await posApi<PosShopPrices>("GET", `/products/${listingId}/prices`);
  return result.ok ? { ok: true, data: result.data } : { ok: false, message: result.message, code: result.code, param: result.param };
}

/** Marks an offline sale's flags looked at. */
export async function resolveFlags(saleId: string): Promise<PosResult<PosFlaggedSale>> {
  if (!uuid.test(saleId)) return refused("No such sale.", null, "resource_missing");
  return answer(await posApi<PosFlaggedSale>("POST", `/sales/${saleId}/flags/resolve`));
}

export type OfflineImport = { device: { id: string; name: string | null }; results: Array<{ client_id: string; kind: string; status: "applied" | "duplicate" | "held" | "rejected"; error?: { message: string } }> };

/** Uploads a file of a till's unsent sales (signed by the till, checked by Udozo). The owner's alone. */
export async function importOfflineFile(file: string): Promise<PosResult<OfflineImport>> {
  let body: { payload?: unknown; signature?: unknown };
  try {
    body = JSON.parse(file);
  } catch {
    return refused("This is not a file of unsent sales from Udozo POS.", "file");
  }
  if (typeof body?.payload !== "string" || typeof body.signature !== "string") return refused("This is not a file of unsent sales from Udozo POS.", "file");
  const result = answer(await customerApi<OfflineImport>("POST", "/v1/pos/owner/offline/import", { payload: body.payload, signature: body.signature }));
  if (result.ok) revalidatePath("/app/offline");
  return result;
}

/** Accepts or rejects a sale an unlinked device uploaded. The owner's alone. */
export async function decideHeld(id: string, decision: "accept" | "reject"): Promise<PosResult<PosOfflineHeld>> {
  if (!uuid.test(id)) return refused("No such sale.", null, "resource_missing");
  return answer(await customerApi<PosOfflineHeld>("POST", `/v1/pos/owner/offline/held/${id}/${decision}`));
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
  payments: Array<{ method: PosPaymentMethod | "credit"; amount: number; tendered?: number | null; reference?: string | null }>;
  expected_total: number;
  note?: string | null;
  /** The shop's customer the sale is made to (needed to sell on credit). */
  customer_id?: string | null;
  /** A manager's PIN given at the till, for a discount past the member of staff's own limit. */
  approval?: Approval | null;
};

/** A manager's PIN given at the till for what a member of staff may only do with approval. */
export type Approval = { staff_id: string; pin: string };

/** The approval to send, if it is one: a colleague's id and their PIN (6 digits, or 4 if set before PINs were 6). */
const approvalOf = (approval: Approval | null | undefined) => (approval && uuid.test(approval.staff_id) && /^(?:\d{4}|\d{6})$/.test(approval.pin) ? { approval: { staff_id: approval.staff_id, pin: approval.pin } } : {});

const tillMethods = [...paymentMethods.map(item => item.value), "credit"];

const whole = (value: unknown, min = 0) => typeof value === "number" && Number.isSafeInteger(value) && value >= min;

/** Rings up a sale at the till. The units come off the listings' stock; payment is recorded, never taken by Udozo. */
export async function ringUp(sale: RingUp): Promise<PosResult<PosSale>> {
  if (!uuid.test(sale.till_id)) return refused("Choose a till.", "till_id", "resource_missing");
  if (!uuid.test(sale.client_sale_id)) return refused("Start a new sale.", "client_sale_id");
  if (!sale.lines.length || sale.lines.length > 100 || sale.lines.some(line => !uuid.test(line.listing_id) || !whole(line.quantity, 1) || (line.discount !== undefined && !whole(line.discount)))) return refused("Add products to the sale.", "lines");
  if (sale.payments.length > 5 || sale.payments.some(payment => !tillMethods.includes(payment.method) || !whole(payment.amount, 1) || (payment.tendered != null && !whole(payment.tendered, 1)))) return refused("Record how it was paid.", "payments");
  if (sale.customer_id && !uuid.test(sale.customer_id)) return refused("Choose the customer again.", "customer_id");
  if (sale.payments.some(payment => payment.method === "credit") && !sale.customer_id) return refused("Choose the customer who will pay later.", "customer_id");
  if (!whole(sale.expected_total) || (sale.discount !== undefined && !whole(sale.discount))) return refused("Check the total.", "expected_total");
  const body = {
    till_id: sale.till_id,
    client_sale_id: sale.client_sale_id,
    lines: sale.lines.map(line => ({ listing_id: line.listing_id, quantity: line.quantity, ...(line.discount ? { discount: line.discount } : {}) })),
    ...(sale.discount ? { discount: sale.discount } : {}),
    payments: sale.payments.map(payment => ({ method: payment.method, amount: payment.amount, ...(payment.method === "cash" && payment.tendered ? { tendered: payment.tendered } : {}), ...(payment.reference?.trim() ? { reference: payment.reference.trim().slice(0, 80) } : {}) })),
    expected_total: sale.expected_total,
    ...(sale.note?.trim() ? { note: sale.note.trim().slice(0, 300) } : {}),
    ...(sale.customer_id ? { customer_id: sale.customer_id } : {}),
    ...approvalOf(sale.approval),
  };
  // The basket's own id is the idempotency key too, so a send that lost its reply is never a second sale.
  return answer(await posApi<PosSale>("POST", "/sales", body, { idempotencyKey: `sale-${sale.client_sale_id}` }));
}

/** Refunds a whole sale (the shop pays it back as it was paid), putting its units back unless `restock` is false. */
export async function refundSale(id: string, reason: string, restock = true, approval: Approval | null = null): Promise<PosResult<PosSale>> {
  if (!uuid.test(id)) return refused("No such sale.", null, "resource_missing");
  if (!reason.trim()) return refused("Say why it is refunded.", "reason", "parameter_missing");
  return answer(await posApi<PosSale>("POST", `/sales/${id}/refund`, { reason: reason.trim().slice(0, 300), restock, ...approvalOf(approval) }));
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
  if (phone && !/^\+?\d{7,15}$/.test(phone)) return refused("Give the buyer's Udozo mobile number.", "phone");
  const body = {
    till_id: sale.till_id,
    client_sale_id: sale.client_sale_id,
    lines: sale.lines.map(line => ({ listing_id: line.listing_id, quantity: line.quantity })),
    ...(sale.discount ? { discount: sale.discount } : {}),
    payments: sale.payments.map(payment => ({ method: payment.method, amount: payment.amount, ...(payment.method === "cash" && payment.tendered ? { tendered: payment.tendered } : {}), ...(payment.reference?.trim() ? { reference: payment.reference.trim().slice(0, 80) } : {}) })),
    wallet_amount: sale.wallet_amount,
    expected_total: sale.expected_total,
    ...(phone ? { phone } : {}),
    ...(sale.customer_id && uuid.test(sale.customer_id) ? { customer_id: sale.customer_id } : {}),
    ...approvalOf(sale.approval),
  };
  const result = await posApi<PosWalletRequest & { token: string; pay_url: string }>("POST", "/wallet-requests", body);
  return result.ok ? { ok: true, data: result.data } : { ok: false, message: result.status === 401 ? "Your session ended. Sign in again to carry on." : result.message, code: result.code, param: result.param };
}

/** Where a wallet request stands; once paid, it carries the sale. */
export async function walletStatus(id: string): Promise<PosResult<PosWalletRequest>> {
  if (!uuid.test(id)) return refused("No such request.", null, "resource_missing");
  const result = await posApi<PosWalletRequest>("GET", `/wallet-requests/${id}`);
  if (!result.ok) return { ok: false, message: result.message, code: result.code, param: result.param };
  if (result.data.status === "paid") revalidatePath("/app", "layout");
  return { ok: true, data: result.data };
}

export async function cancelWallet(id: string): Promise<PosResult<PosWalletRequest>> {
  if (!uuid.test(id)) return refused("No such request.", null, "resource_missing");
  const result = await posApi<PosWalletRequest>("POST", `/wallet-requests/${id}/cancel`);
  return result.ok ? { ok: true, data: result.data } : { ok: false, message: result.message, code: result.code, param: result.param };
}

export type CustomerFields = { name?: string; phone?: string | null; email?: string | null; address?: string | null; notes?: string | null; credit_limit?: number | null };

function customerBody(fields: CustomerFields) {
  const clean = (value: string | null | undefined, max: number) => (value === undefined ? undefined : value === null ? null : value.trim().slice(0, max) || null);
  return {
    ...(fields.name !== undefined ? { name: fields.name.trim().slice(0, 120) } : {}),
    ...(fields.phone !== undefined ? { phone: clean(fields.phone, 30) } : {}),
    ...(fields.email !== undefined ? { email: clean(fields.email, 254) } : {}),
    ...(fields.address !== undefined ? { address: clean(fields.address, 300) } : {}),
    ...(fields.notes !== undefined ? { notes: clean(fields.notes, 1000) } : {}),
    ...(fields.credit_limit !== undefined ? { credit_limit: fields.credit_limit } : {}),
  };
}

/** Adds one of the shop's customers (`id` null) or changes one: their own record, no Udozo account needed. */
export async function saveCustomer(id: string | null, fields: CustomerFields): Promise<PosResult<PosCustomer>> {
  if (id !== null && !uuid.test(id)) return refused("No such customer.", null, "resource_missing");
  if ((id === null || fields.name !== undefined) && !fields.name?.trim()) return refused("Give the customer's name.", "name", "parameter_missing");
  if (fields.credit_limit != null && !whole(fields.credit_limit)) return refused("A credit limit is an amount from nothing up.", "credit_limit");
  const result = id === null ? await posApi<PosCustomer>("POST", "/customers", customerBody(fields)) : await posApi<PosCustomer>("PATCH", `/customers/${id}`, customerBody(fields));
  return answer(result);
}

export async function removeCustomer(id: string): Promise<PosResult<null>> {
  if (!uuid.test(id)) return refused("No such customer.", null, "resource_missing");
  const result = await customerApi<null>("DELETE", `/v1/pos/owner/customers/${id}`);
  return result.ok ? answer({ ok: true, data: null }) : answer(result);
}

/** A repayment of what a customer owes, recorded as it was paid. */
export async function repayCustomer(id: string, amount: number, method: PosPaymentMethod, reference = ""): Promise<PosResult<PosCustomer>> {
  if (!uuid.test(id)) return refused("No such customer.", null, "resource_missing");
  if (!whole(amount, 1)) return refused("Give how much they paid.", "amount");
  if (!paymentMethods.some(item => item.value === method)) return refused("Choose how they paid.", "method");
  return answer(await posApi<PosCustomer>("POST", `/customers/${id}/repayments`, { amount, method, ...(reference.trim() ? { reference: reference.trim().slice(0, 80) } : {}) }));
}

/** Customers matching what the cashier typed, for the till. */
export async function findCustomers(words: string): Promise<PosResult<PosCustomerBrief[]>> {
  const q = words.trim().slice(0, 80);
  const result = await posApi<PosCustomers>("GET", `/customers?limit=8${q ? `&q=${encodeURIComponent(q)}` : ""}`);
  return result.ok ? { ok: true, data: result.data.data } : { ok: false, message: result.message, code: result.code, param: result.param };
}

export type StockKind = "restock" | "count" | "damage";
export type StockAnswer = { object: "pos_stock"; listing_id: string; stock: number; held: number; available: number; movement: PosStockMovement };

/** Restocks, counts or writes off a product's units. */
export async function adjustStock(listingId: string, kind: StockKind, quantity: number, note = "", approval: Approval | null = null, shopId: string | null = null): Promise<PosResult<StockAnswer>> {
  if (!uuid.test(listingId)) return refused("No such product.", null, "resource_missing");
  if (!["restock", "count", "damage"].includes(kind)) return refused("Choose what happened.", "kind");
  if (!whole(quantity, kind === "count" ? 0 : 1) || quantity > 100_000) return refused(kind === "count" ? "Count what is on the shelf: 0 or more." : "Give how many, from 1.", "quantity");
  if (shopId !== null && !uuid.test(shopId)) return refused("Choose which shop.", "shop_id");
  return answer(await posApi<StockAnswer>("POST", `/stock/${listingId}`, { kind, quantity, ...(note.trim() ? { note: note.trim().slice(0, 200) } : {}), ...approvalOf(approval), ...(shopId ? { shop_id: shopId } : {}) }));
}

/** A product's latest stock movements, newest first. */
export async function stockHistory(listingId: string): Promise<PosResult<PosStockMovement[]>> {
  if (!uuid.test(listingId)) return refused("No such product.", null, "resource_missing");
  const result = await posApi<{ data: PosStockMovement[] }>("GET", `/stock/${listingId}/movements`);
  return result.ok ? { ok: true, data: result.data.data } : { ok: false, message: result.status === 401 ? "Your session ended. Sign in again to carry on." : result.message, code: result.code, param: result.param };
}

/** Signing out of pos.udozo.com only: udozo.com keeps its own session. */
export async function signOut() {
  await customerApi("POST", "/v1/store/account/signout");
  await dropSession();
  await dropStaffSession();
  redirect("/");
}

// ---- Udozo collection accounts (milestone 4) ----

/** Where collections are paid: one of the owner's udozo.com payout bank accounts, or none. */
export async function setSettlementAccount(bankAccountId: string | null): Promise<PosResult<PosCollectionsOverview>> {
  if (bankAccountId !== null && !uuid.test(bankAccountId)) return refused("Choose one of your bank accounts.", "bank_account_id");
  return answer(await customerApi<PosCollectionsOverview>("PUT", "/v1/pos/owner/collections/settlement-account", { bank_account_id: bankAccountId }));
}

/** Asks Udozo's banks for a till's account number; in Nigeria, live, with the owner's BVN (passed on, never kept). */
export async function openCollectionAccount(tillId: string, bvn = ""): Promise<PosResult<PosCollectionAccount>> {
  if (!uuid.test(tillId)) return refused("Choose a till.", "till_id", "resource_missing");
  const digits = bvn.replace(/\s/g, "");
  if (digits && !/^\d{11}$/.test(digits)) return refused("A BVN is 11 digits.", "bvn");
  return answer(await customerApi<PosCollectionAccount>("POST", `/v1/pos/owner/tills/${tillId}/collection-account`, digits ? { bvn: digits } : {}));
}

export async function closeCollectionAccount(id: string): Promise<PosResult<PosCollectionAccount>> {
  if (!uuid.test(id)) return refused("No such account.", null, "resource_missing");
  return answer(await customerApi<PosCollectionAccount>("POST", `/v1/pos/owner/collection-accounts/${id}/close`));
}

/** The sandbox only: a made-up transfer into an account, to try it. */
export async function simulateCollection(id: string, amount: number, payerName = ""): Promise<PosResult<PosCollection>> {
  if (!uuid.test(id)) return refused("No such account.", null, "resource_missing");
  if (!whole(amount, 1)) return refused("Give the amount.", "amount");
  return answer(await customerApi<PosCollection>("POST", `/v1/pos/owner/collection-accounts/${id}/simulate`, { amount, ...(payerName.trim() ? { payer_name: payerName.trim().slice(0, 120) } : {}) }));
}

/** Attaches an unmatched transfer to the sale it was for, which makes the sale. */
export async function attachCollection(id: string, requestId: string): Promise<PosResult<PosCollection>> {
  if (!uuid.test(id) || !uuid.test(requestId)) return refused("Choose the sale it was for.", "transfer_request_id");
  return answer(await posApi<PosCollection>("POST", `/collections/transfers/${id}/attach`, { transfer_request_id: requestId }));
}

/** Keeps an unmatched transfer for no sale: it is paid to the bank with the day's collections all the same. */
export async function keepCollection(id: string, note = ""): Promise<PosResult<PosCollection>> {
  if (!uuid.test(id)) return refused("No such transfer.", null, "resource_missing");
  return answer(await posApi<PosCollection>("POST", `/collections/transfers/${id}/keep`, note.trim() ? { note: note.trim().slice(0, 300) } : {}));
}

/** The till asks for the rest of the basket by transfer into its Udozo account: the transfer makes the sale. */
export async function askTransfer(sale: RingUp & { transfer_amount: number }): Promise<PosResult<PosTransferRequest>> {
  if (!uuid.test(sale.till_id) || !uuid.test(sale.client_sale_id)) return refused("Start a new sale.", "client_sale_id");
  if (!sale.lines.length || sale.lines.some(line => !uuid.test(line.listing_id) || !whole(line.quantity, 1))) return refused("Add products to the sale.", "lines");
  if (!whole(sale.transfer_amount, 1) || !whole(sale.expected_total)) return refused("Check the total.", "transfer_amount");
  const body = {
    till_id: sale.till_id,
    client_sale_id: sale.client_sale_id,
    lines: sale.lines.map(line => ({ listing_id: line.listing_id, quantity: line.quantity })),
    ...(sale.discount ? { discount: sale.discount } : {}),
    payments: sale.payments.map(payment => ({ method: payment.method, amount: payment.amount, ...(payment.method === "cash" && payment.tendered ? { tendered: payment.tendered } : {}), ...(payment.reference?.trim() ? { reference: payment.reference.trim().slice(0, 80) } : {}) })),
    transfer_amount: sale.transfer_amount,
    expected_total: sale.expected_total,
    ...(sale.customer_id && uuid.test(sale.customer_id) ? { customer_id: sale.customer_id } : {}),
    ...approvalOf(sale.approval),
  };
  const result = await posApi<PosTransferRequest>("POST", "/transfer-requests", body);
  return result.ok ? { ok: true, data: result.data } : { ok: false, message: result.status === 401 ? "Your session ended. Sign in again to carry on." : result.message, code: result.code, param: result.param };
}

/** Where a transfer request stands; once paid, with the sale it made. */
export async function transferStatus(id: string): Promise<PosResult<PosTransferRequest & { sale: PosSale | null }>> {
  if (!uuid.test(id)) return refused("No such request.", null, "resource_missing");
  const result = await posApi<PosTransferRequest>("GET", `/transfer-requests/${id}`);
  if (!result.ok) return { ok: false, message: result.message, code: result.code, param: result.param };
  if (result.data.status !== "paid" || !result.data.sale_id) return { ok: true, data: { ...result.data, sale: null } };
  const sale = await posApi<PosSale>("GET", `/sales/${result.data.sale_id}`);
  revalidatePath("/app", "layout");
  return { ok: true, data: { ...result.data, sale: sale.ok ? sale.data : null } };
}

export async function cancelTransfer(id: string): Promise<PosResult<PosTransferRequest>> {
  if (!uuid.test(id)) return refused("No such request.", null, "resource_missing");
  const result = await posApi<PosTransferRequest>("POST", `/transfer-requests/${id}/cancel`);
  return result.ok ? { ok: true, data: result.data } : { ok: false, message: result.message, code: result.code, param: result.param };
}
