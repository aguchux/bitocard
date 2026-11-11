"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { type PosAccount, type PosPlan, planOrder } from "./pos";
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

/** Signing out of pos.udozo.com only: udozo.com keeps its own session. */
export async function signOut() {
  await customerApi("POST", "/v1/store/account/signout");
  await dropSession();
  redirect("/");
}
