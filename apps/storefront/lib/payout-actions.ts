"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { StoreCustomerBankAccount, StoreCustomerPayout } from "@bitocard/api-client/storefront";
import type { FormState } from "@/lib/account-actions";
import { customerApi } from "@/lib/customer";

/** A form that moves money carries a nonce (its Idempotency-Key); every answer leaving it on screen carries a fresh one. */
export type NonceFormState = FormState & { nonce?: string };

const text = (form: FormData, name: string) => String(form.get(name) ?? "").trim();
const fresh = (state: FormState): NonceFormState => ({ ...state, nonce: randomUUID() });
const page = "/shop/payouts";

function signInFirst(status: number) {
  if (status === 401) redirect(`/signin?next=${encodeURIComponent(page)}`);
}

/** Money typed by people ("1,650.50") in minor units, or null when it is not a positive amount. */
function toMinor(value: string) {
  const amount = Math.round(Number(value.replace(/[,\s]/g, "")) * 100);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

/** Refreshes the pages showing the payout accounts: Payouts and Safe pay's set-up. */
function refresh() {
  revalidatePath(page);
  revalidatePath("/shop/safe-pay");
}

/** Adds a bank account to be paid into (in the customer's verified name; usable after 24 hours on live stores). */
export async function addPayoutAccount(_state: FormState, form: FormData): Promise<FormState> {
  const bankCode = text(form, "bank_code");
  const accountNumber = text(form, "account_number").replace(/\s/g, "");
  if (!bankCode) return { error: "Choose your bank.", field: "bank_code" };
  if (!/^\d{6,20}$/.test(accountNumber)) return { error: "Enter your account number, digits only.", field: "account_number" };
  const result = await customerApi<StoreCustomerBankAccount>("POST", "/v1/store/cash/bank-accounts", { bank_code: bankCode, account_number: accountNumber });
  if (!result.ok) {
    signInFirst(result.status);
    return { error: result.message, field: result.param === "account_number" || result.param === "bank_code" ? result.param : null };
  }
  refresh();
  return { notice: `Added ${result.data.bank_name} ending ${result.data.account_number_last4} (${result.data.account_name}).` };
}

export async function removePayoutAccount(_state: FormState, form: FormData): Promise<FormState> {
  const result = await customerApi("DELETE", `/v1/store/cash/bank-accounts/${encodeURIComponent(text(form, "id"))}`);
  if (!result.ok) {
    signInFirst(result.status);
    return { error: result.message };
  }
  refresh();
  return {};
}

/** Pays the money from the customer's sales out to one of their bank accounts (the amount typed in their currency). */
export async function payOut(_state: NonceFormState, form: FormData): Promise<NonceFormState> {
  const amount = toMinor(text(form, "amount"));
  const account = text(form, "bank_account_id");
  if (!account) return { error: "Choose the account to pay into.", field: "bank_account_id" };
  if (!amount) return { error: "Enter how much to pay out.", field: "amount" };
  const result = await customerApi<StoreCustomerPayout>("POST", "/v1/store/cash/payouts", { amount, bank_account_id: account }, { idempotencyKey: text(form, "nonce") || undefined });
  if (!result.ok) {
    signInFirst(result.status);
    return fresh({ error: result.message, field: result.param === "amount" ? "amount" : null });
  }
  refresh();
  // A fresh nonce: another payout from the same form is a new request.
  return fresh({ notice: result.data.status === "failed" ? `The bank refused it: ${result.data.failure_reason ?? "try another account"}. The money is back in your balance.` : "On its way to your bank." });
}

/** Sandbox only: settles a test payout as paid or failed. */
export async function simulatePayout(_state: FormState, form: FormData): Promise<FormState> {
  const result = await customerApi("POST", `/v1/store/cash/payouts/${encodeURIComponent(text(form, "id"))}/simulate`, { outcome: text(form, "outcome") === "failed" ? "failed" : "paid" });
  if (!result.ok) return { error: result.message };
  revalidatePath(page);
  return {};
}
