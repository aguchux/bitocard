"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { StoreReservedAccount, StoreWallet, StoreWalletTopUp } from "@bitocard/api-client/storefront";
import type { FormState } from "@/lib/account-actions";
import { customerApi, siteOrigin } from "@/lib/customer";

const text = (form: FormData, name: string) => String(form.get(name) ?? "").trim();

/**
 * The signed-in customer's wallet: always in their own country's currency (chosen at sign-up and fixed; a reseller's
 * store is the reseller's). Null when signed out, before an older account has chosen its country, or when the API
 * cannot be reached.
 */
export async function walletFor(): Promise<StoreWallet | null> {
  const result = await customerApi<StoreWallet>("GET", "/v1/store/wallet");
  return result.ok ? result.data : null;
}

/** Opens a payment page to top the wallet up; it returns to the wallet with the top-up's ID. */
export async function topUpWallet(_state: FormState, form: FormData): Promise<FormState> {
  const amount = Math.round(Number(text(form, "amount")) * 100);
  if (!Number.isFinite(amount) || amount < 100) return { error: "Enter an amount of at least 1.", field: "amount" };
  const back = new URL(`${await siteOrigin()}/account/wallet`);
  const result = await customerApi<StoreWalletTopUp>("POST", "/v1/store/wallet/top-ups", {
    amount,
    method: text(form, "method") || undefined,
    return_url: back.toString(),
  });
  if (!result.ok) {
    if (result.status === 401) redirect(`/signin?next=${encodeURIComponent("/account/wallet")}`);
    if (result.code === "email_not_verified") redirect(`/account/verify?next=${encodeURIComponent("/account/wallet")}`);
    return { error: result.message, field: result.param };
  }
  // Live: to the payment page. The sandbox has none: the wallet page simulates it.
  if (result.data.mode === "live" && result.data.checkout_url) redirect(result.data.checkout_url);
  redirect(`/account/wallet?${new URLSearchParams({ top_up: result.data.id }).toString()}`);
}

/** Opens the customer's own bank account number for the wallet (Nigeria asks for the BVN, passed to the bank only). */
export async function openBankAccount(_state: FormState, form: FormData): Promise<FormState> {
  const result = await customerApi<{ data: StoreReservedAccount[] }>("POST", "/v1/store/wallet/reserved-accounts", { bvn: text(form, "bvn") || undefined });
  if (!result.ok) return { error: result.message, field: result.param };
  revalidatePath("/account/wallet");
  return { notice: "Your account number is ready. Transfers into it top up your wallet." };
}

/** Sandbox stores only: finish a top-up as paid or failed. */
export async function simulateTopUp(form: FormData) {
  const id = text(form, "id");
  await customerApi("POST", `/v1/store/wallet/top-ups/${encodeURIComponent(id)}/simulate`, { outcome: text(form, "outcome") });
  revalidatePath("/account/wallet");
}

/** Sandbox stores only: a transfer into the customer's account number. */
export async function simulateDeposit(form: FormData) {
  const id = text(form, "id");
  await customerApi("POST", `/v1/store/wallet/reserved-accounts/${encodeURIComponent(id)}/simulate-deposit`, { amount: Math.round(Number(text(form, "amount")) * 100) });
  revalidatePath("/account/wallet");
}

