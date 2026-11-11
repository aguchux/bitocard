"use server";

import { revalidatePath } from "next/cache";
import { customerApi } from "./customer";
import { type PosWalletPayment, posPayToken } from "./pos-pay";

export type PosPayResult = { ok: true; data: PosWalletPayment } | { ok: false; message: string; code: string | null; signIn: boolean };

const unknown: PosPayResult = { ok: false, message: "This payment request is not here any more. Ask the shop for a new one.", code: "resource_missing", signIn: false };

/** Pays the shop from the Udozo wallet: exactly the amount the buyer saw, or nothing. */
export async function payPos(token: string, expectedAmount: number): Promise<PosPayResult> {
  if (!posPayToken.test(token)) return unknown;
  if (!Number.isSafeInteger(expectedAmount) || expectedAmount < 1) return { ok: false, message: "Look at the amount again.", code: "parameter_invalid", signIn: false };
  const result = await customerApi<PosWalletPayment>("POST", `/v1/store/account/pos-payments/${token}/pay`, { expected_amount: expectedAmount });
  revalidatePath(`/pay/${token}`);
  return result.ok ? { ok: true, data: result.data } : { ok: false, message: result.status === 401 ? "Sign in to carry on." : result.message, code: result.code, signIn: result.status === 401 };
}

export async function declinePos(token: string): Promise<PosPayResult> {
  if (!posPayToken.test(token)) return unknown;
  const result = await customerApi<PosWalletPayment>("POST", `/v1/store/account/pos-payments/${token}/decline`);
  revalidatePath(`/pay/${token}`);
  return result.ok ? { ok: true, data: result.data } : { ok: false, message: result.message, code: result.code, signIn: result.status === 401 };
}
