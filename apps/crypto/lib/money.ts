"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FormState, NonceFormState } from "@bitocard/crypto-ui/forms";
import { moneyActions } from "@bitocard/crypto-ui/money-actions";
import { customerApi, signInPath } from "@/lib/customer";

/**
 * BitoCard Crypto's money actions (on-chain withdrawals): the work is `@bitocard/crypto-ui`'s
 * (`moneyActions`, shared with the storefront's Crypto tab), over this site's own customer session and on its own pages.
 */
const money = moneyActions({
  api: customerApi,
  paths: {
    withdraw: "/withdraw",
    withdrawConfirm: "/withdraw/confirm",
    withdrawal: id => `/withdrawals/${id}`,
    signIn: next => signInPath(next),
    refresh: ["/"],
  },
  redirect,
  revalidate: revalidatePath,
});

export async function addWithdrawalAddress(_state: FormState, form: FormData): Promise<FormState> {
  return money.addWithdrawalAddress(form);
}

export async function removeWithdrawalAddress(_state: FormState, form: FormData): Promise<FormState> {
  return money.removeWithdrawalAddress(form);
}

export async function reviewWithdrawal(_state: FormState, form: FormData): Promise<FormState> {
  return money.reviewWithdrawal(form);
}

export async function createWithdrawal(_state: NonceFormState, form: FormData): Promise<NonceFormState> {
  return money.createWithdrawal(form);
}

export async function confirmWithdrawal(_state: FormState, form: FormData): Promise<FormState> {
  return money.confirmWithdrawal(form);
}

export async function resendWithdrawalCode(_state: FormState, form: FormData): Promise<FormState> {
  return money.resendWithdrawalCode(form);
}

export async function cancelWithdrawal(_state: FormState, form: FormData): Promise<FormState> {
  return money.cancelWithdrawal(form);
}
