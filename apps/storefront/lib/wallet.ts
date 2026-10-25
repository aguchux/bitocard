"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { StoreReservedAccount, StoreWallet, StoreWalletTopUp } from "@bitocard/api-client/storefront";
import type { FormState } from "@/lib/account-actions";
import { customerApi, siteOrigin } from "@/lib/customer";

const text = (form: FormData, name: string) => String(form.get(name) ?? "").trim();

/**
 * One of the signed-in customer's wallets: their own country's currency (chosen at sign-up and fixed; a reseller's
 * store is the reseller's) unless `USD` is asked for. `wallets` lists both. Null when signed out, before an older
 * account has chosen its country, or when the API cannot be reached.
 */
export async function walletFor(currency?: string): Promise<StoreWallet | null> {
  const result = await customerApi<StoreWallet>("GET", `/v1/store/wallet${currency ? `?${new URLSearchParams({ currency }).toString()}` : ""}`);
  return result.ok ? result.data : null;
}

/** Opens a payment page to top a wallet up (the country's, or `currency` USD); it returns to that wallet with the top-up's ID. */
export async function topUpWallet(_state: FormState, form: FormData): Promise<FormState> {
  const amount = Math.round(Number(text(form, "amount").replace(/[,\s]/g, "")) * 100);
  if (!Number.isFinite(amount) || amount < 100) return { error: "Enter an amount of at least 1.", field: "amount" };
  const currency = text(form, "currency") || undefined;
  const back = new URL(`${await siteOrigin()}/account/wallet`);
  if (currency) back.searchParams.set("wallet", currency);
  const result = await customerApi<StoreWalletTopUp>("POST", "/v1/store/wallet/top-ups", {
    amount,
    method: text(form, "method") || undefined,
    return_url: back.toString(),
    currency,
  });
  if (!result.ok) {
    if (result.status === 401) redirect(`/signin?next=${encodeURIComponent("/account/wallet")}`);
    if (result.code === "email_not_verified") redirect(`/account/verify?next=${encodeURIComponent("/account/wallet")}`);
    return { error: result.message, field: result.param };
  }
  // Live: to the payment page. The sandbox has none: the wallet page simulates it.
  if (result.data.mode === "live" && result.data.checkout_url) redirect(result.data.checkout_url);
  redirect(`/account/wallet?${new URLSearchParams({ ...(currency ? { wallet: currency } : {}), top_up: result.data.id }).toString()}`);
}

/** Opens the customer's own bank account number for the wallet (Nigeria asks for the BVN, passed to the bank only). */
export async function openBankAccount(_state: FormState, form: FormData): Promise<FormState> {
  const result = await customerApi<{ data: StoreReservedAccount[] }>("POST", "/v1/store/wallet/reserved-accounts", { bvn: text(form, "bvn") || undefined });
  if (!result.ok) return { error: result.message, field: result.param };
  revalidatePath("/account/wallet");
  return { notice: "Your account number is ready. Transfers into it top up your wallet." };
}

/**
 * The customer gave up on a top-up's payment page: it is closed, so the waiting notice goes. Paid after all, it is
 * credited and shown as added instead. `back` is the wallet tab they were on.
 */
export async function cancelTopUp(form: FormData) {
  const id = text(form, "id");
  const back = text(form, "back");
  const target = new URL(back.startsWith("/account/wallet") ? back : "/account/wallet", "https://store.invalid");
  const result = await customerApi<StoreWalletTopUp>("POST", `/v1/store/wallet/top-ups/${encodeURIComponent(id)}/cancel`, {});
  revalidatePath("/account/wallet");
  if (!result.ok) {
    target.searchParams.set("top_up", id);
    target.searchParams.set("cancel_error", result.code ?? "unavailable");
  } else if (result.data.status === "succeeded") {
    target.searchParams.set("top_up", id);
  }
  redirect(`${target.pathname}${target.search}`);
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

