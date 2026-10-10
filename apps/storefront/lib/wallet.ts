"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { StoreReservedAccount, StoreWallet, StoreWalletTopUp } from "@bitocard/api-client/storefront";
import type { FormState } from "@/lib/account-actions";
import { customerApi, siteOrigin } from "@/lib/customer";

const text = (form: FormData, name: string) => String(form.get(name) ?? "").trim();

/**
 * The signed-in customer's wallet in a country (bitocard.com; a reseller's store is always its own country), for the
 * buy form when the shopper changes "Paying from". Null when signed out or the API cannot be reached.
 */
export async function walletFor(country: string | null): Promise<StoreWallet | null> {
  if (country !== null && !/^[A-Z]{2}$/.test(country)) return null;
  const result = await customerApi<StoreWallet>("GET", `/v1/store/wallet${country ? `?country=${country}` : ""}`);
  return result.ok ? result.data : null;
}

/** Opens a payment page to top the wallet up; it returns to the wallet with the top-up's ID. */
export async function topUpWallet(_state: FormState, form: FormData): Promise<FormState> {
  const amount = Math.round(Number(text(form, "amount")) * 100);
  if (!Number.isFinite(amount) || amount < 100) return { error: "Enter an amount of at least 1.", field: "amount" };
  const country = text(form, "country") || undefined;
  const back = new URL(`${await siteOrigin()}/account/wallet`);
  if (country) back.searchParams.set("country", country);
  const result = await customerApi<StoreWalletTopUp>("POST", "/v1/store/wallet/top-ups", {
    amount,
    country,
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
  redirect(`/account/wallet?${new URLSearchParams({ ...(country ? { country } : {}), top_up: result.data.id }).toString()}`);
}

/** Opens the customer's own bank account number for the wallet (Nigeria asks for the BVN, passed to the bank only). */
export async function openBankAccount(_state: FormState, form: FormData): Promise<FormState> {
  const country = text(form, "country") || undefined;
  const result = await customerApi<{ data: StoreReservedAccount[] }>("POST", "/v1/store/wallet/reserved-accounts", { country, bvn: text(form, "bvn") || undefined });
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

