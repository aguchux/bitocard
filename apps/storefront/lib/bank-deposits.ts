"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { StoreBankDeposit, StoreBankDepositOptions, StoreList } from "@bitocard/api-client/storefront";
import type { FormState } from "@/lib/account-actions";
import { customerApi } from "@/lib/customer";

const text = (form: FormData, name: string) => String(form.get(name) ?? "").trim();
const path = (id: string) => `/account/wallet/deposits/${encodeURIComponent(id)}`;

/** Whether a wallet can be topped up by bank deposit here, and into which of Golojan's accounts (null when it cannot be read). */
export async function bankDepositOptions(currency?: string): Promise<StoreBankDepositOptions | null> {
  const result = await customerApi<StoreBankDepositOptions>("GET", `/v1/store/wallet/bank-deposits/options${currency ? `?${new URLSearchParams({ currency }).toString()}` : ""}`);
  return result.ok ? result.data : null;
}

/** The customer's latest bank deposits (newest first). */
export async function myBankDeposits(): Promise<StoreBankDeposit[]> {
  const result = await customerApi<StoreList<StoreBankDeposit>>("GET", "/v1/store/wallet/bank-deposits");
  return result.ok ? result.data.data : [];
}

/** Starts a bank deposit for an amount, then opens its page with where to pay and the reference to write. */
export async function startBankDeposit(_state: FormState, form: FormData): Promise<FormState> {
  const amount = Math.round(Number(text(form, "amount").replace(/[,\s]/g, "")) * 100);
  if (!Number.isFinite(amount) || amount < 100) return { error: "Enter an amount of at least 1.", field: "amount" };
  const result = await customerApi<StoreBankDeposit>("POST", "/v1/store/wallet/bank-deposits", {
    amount,
    currency: text(form, "currency") || undefined,
    account_id: text(form, "account_id") || undefined,
  });
  if (!result.ok) {
    if (result.status === 401) redirect(`/signin?next=${encodeURIComponent("/account/wallet")}`);
    if (result.code === "email_not_verified") redirect(`/account/verify?next=${encodeURIComponent("/account/wallet")}`);
    return { error: result.message, field: result.param === "account_id" ? undefined : result.param };
  }
  redirect(path(result.data.id));
}

/** "I've sent it": how they paid and the name the money came from, so finance can find it. */
export async function markDepositSent(_state: FormState, form: FormData): Promise<FormState> {
  const id = text(form, "id");
  const method = text(form, "method");
  if (method !== "cash" && method !== "transfer") return { error: "Choose how you paid.", field: "method" };
  const senderName = text(form, "sender_name");
  if (senderName.length < 2) return { error: "Enter the name on the deposit slip or the account you paid from.", field: "sender_name" };
  const result = await customerApi<StoreBankDeposit>("POST", `/v1/store/wallet/bank-deposits/${encodeURIComponent(id)}/sent`, { method, sender_name: senderName, note: text(form, "note") || undefined });
  if (!result.ok) return { error: result.message, field: result.param };
  revalidatePath(path(id));
  revalidatePath("/account/wallet");
  return { notice: "Thank you. We are checking our bank and will add it to your wallet once it arrives." };
}

export async function cancelBankDeposit(form: FormData) {
  const id = text(form, "id");
  await customerApi<StoreBankDeposit>("POST", `/v1/store/wallet/bank-deposits/${encodeURIComponent(id)}/cancel`, {});
  revalidatePath(path(id));
  revalidatePath("/account/wallet");
}
