"use server";

import { revalidatePath } from "next/cache";
import type { PosShift } from "./pos";
import { posApi } from "./pos-api";
import type { ApiResult } from "./session";

/** What a shift action answers: the shift as it now is, or Udozo's refusal in words with the field it names. */
export type ShiftResult = { ok: true; data: PosShift } | { ok: false; message: string; code: string | null; param: string | null };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const refused = (message: string, param: string | null = null): ShiftResult => ({ ok: false, message, code: "parameter_invalid", param });
const amount = (value: number, min = 0) => Number.isSafeInteger(value) && value >= min && value <= 10_000_000_000;

function answer(result: ApiResult<PosShift>): ShiftResult {
  if (!result.ok) return { ok: false, message: result.status === 401 ? "Your session ended. Sign in again to carry on." : result.message, code: result.code, param: result.param };
  revalidatePath("/app", "layout");
  return { ok: true, data: result.data };
}

/** Opens a shift at a till with the cash in its drawer (minor units). */
export async function openShift(tillId: string, openingFloat: number, note?: string): Promise<ShiftResult> {
  if (!uuid.test(tillId)) return refused("Choose a till.", "till_id");
  if (!amount(openingFloat)) return refused("Give the cash in the drawer.", "opening_float");
  return answer(await posApi<PosShift>("POST", "/shifts", { till_id: tillId, opening_float: openingFloat, ...(note?.trim() ? { note: note.trim().slice(0, 300) } : {}) }));
}

/** Cash paid into the drawer or out of it, with why. */
export async function shiftCash(shiftId: string, kind: "in" | "out", value: number, reason: string): Promise<ShiftResult> {
  if (!uuid.test(shiftId)) return refused("No such shift.");
  if (kind !== "in" && kind !== "out") return refused("Say whether cash went in or out.", "kind");
  if (!amount(value, 1)) return refused("Give how much.", "amount");
  if (!reason.trim()) return refused("Say why.", "reason");
  return answer(await posApi<PosShift>("POST", `/shifts/${shiftId}/cash`, { kind, amount: value, reason: reason.trim().slice(0, 200) }));
}

/** Closes a shift with the cash counted in the drawer. */
export async function closeShift(shiftId: string, counted: number, note?: string): Promise<ShiftResult> {
  if (!uuid.test(shiftId)) return refused("No such shift.");
  if (!amount(counted)) return refused("Give the cash you counted.", "counted");
  return answer(await posApi<PosShift>("POST", `/shifts/${shiftId}/close`, { counted, ...(note?.trim() ? { note: note.trim().slice(0, 300) } : {}) }));
}
