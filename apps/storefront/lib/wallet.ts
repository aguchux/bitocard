"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { StoreWallet } from "@bitocard/api-client/storefront";
import { topUpActions } from "@bitocard/crypto-ui/top-up-actions";
import type { FormState } from "@/lib/account-actions";
import { customerApi, siteOrigin } from "@/lib/customer";

/**
 * One of the signed-in customer's wallets: their own country's currency (chosen at sign-up and fixed; a reseller's
 * store is the reseller's) unless `USD` is asked for. `wallets` lists both. Null when signed out, before an older
 * account has chosen its country, or when the API cannot be reached.
 */
export async function walletFor(currency?: string): Promise<StoreWallet | null> {
  const result = await customerApi<StoreWallet>("GET", `/v1/store/wallet${currency ? `?${new URLSearchParams({ currency }).toString()}` : ""}`);
  return result.ok ? result.data : null;
}

/**
 * Adding money: the work is `@bitocard/crypto-ui`'s (`topUpActions`, shared with BitoCard Crypto), over this store's
 * customer session, returning to the Wallet tab.
 */
const wallet = topUpActions({
  api: customerApi,
  paths: {
    wallet: "/account/wallet",
    origin: siteOrigin,
    signIn: next => `/signin?next=${encodeURIComponent(next)}`,
    verifyEmail: next => `/account/verify?next=${encodeURIComponent(next)}`,
  },
  redirect,
  revalidate: revalidatePath,
});

/** Opens a payment page to top a wallet up (the country's, or `currency` USD); it returns to that wallet with the top-up's ID. */
export async function topUpWallet(_state: FormState, form: FormData): Promise<FormState> {
  return wallet.topUp(form);
}

/** Opens the customer's own bank account number for the wallet (Nigeria asks for the BVN, passed to the bank only). */
export async function openBankAccount(_state: FormState, form: FormData): Promise<FormState> {
  return wallet.openBankAccount(form);
}

/** The customer gave up on a top-up's payment page: it is closed (credited and shown as added if it was paid after all). */
export async function cancelTopUp(form: FormData) {
  return wallet.cancelTopUp(form);
}

/** Sandbox stores only: finish a top-up as paid or failed. */
export async function simulateTopUp(form: FormData) {
  return wallet.simulateTopUp(form);
}

/** Sandbox stores only: a transfer into the customer's account number. */
export async function simulateDeposit(form: FormData) {
  return wallet.simulateDeposit(form);
}
