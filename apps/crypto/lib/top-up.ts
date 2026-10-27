"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FormState } from "@bitocard/crypto-ui/forms";
import { topUpActions } from "@bitocard/crypto-ui/top-up-actions";
import { customerApi, signInPath, siteOrigin } from "@/lib/customer";

/**
 * Adding money to the customer's BitoCard wallets on this site: the work is `@bitocard/crypto-ui`'s (`topUpActions`,
 * shared with the storefront's Wallet tab), over this site's own session, returning to `/add-money`.
 */
const wallet = topUpActions({
  api: customerApi,
  paths: {
    wallet: "/add-money",
    origin: siteOrigin,
    signIn: next => signInPath(next),
    verifyEmail: next => `/verify?next=${encodeURIComponent(next)}`,
  },
  redirect,
  revalidate: revalidatePath,
});

export async function topUpWallet(_state: FormState, form: FormData): Promise<FormState> {
  return wallet.topUp(form);
}

export async function openBankAccount(_state: FormState, form: FormData): Promise<FormState> {
  return wallet.openBankAccount(form);
}

export async function cancelTopUp(form: FormData): Promise<void> {
  return wallet.cancelTopUp(form);
}

export async function simulateTopUp(form: FormData): Promise<void> {
  return wallet.simulateTopUp(form);
}

export async function simulateDeposit(form: FormData): Promise<void> {
  return wallet.simulateDeposit(form);
}
