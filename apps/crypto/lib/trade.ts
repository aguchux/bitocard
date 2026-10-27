"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FormState, NonceFormState } from "@bitocard/crypto-ui/forms";
import { tradeActions } from "@bitocard/crypto-ui/trade-actions";
import { customerApi, signInPath } from "@/lib/customer";

/**
 * BitoCard Crypto's trading actions: the work is `@bitocard/crypto-ui`'s (`tradeActions`, shared with the storefront's
 * Crypto tab), over this site's own customer session and on its own pages.
 */
const trade = tradeActions({
  api: customerApi,
  paths: { confirm: "/confirm", trade: id => `/trades/${id}?done=1`, ads: "/ads", signIn: next => signInPath(next, "trade"), refresh: ["/"] },
  redirect,
  revalidate: revalidatePath,
});

export async function declareCrypto(form: FormData): Promise<void> {
  return trade.declare(form);
}

export async function takeAd(_state: FormState, form: FormData): Promise<FormState> {
  return trade.takeAd(form);
}

export async function confirmTrade(_state: NonceFormState, form: FormData): Promise<NonceFormState> {
  return trade.confirmTrade(form);
}

export async function postAd(_state: FormState, form: FormData): Promise<FormState> {
  return trade.postAd(form);
}

export async function changeAd(_state: FormState, form: FormData): Promise<FormState> {
  return trade.changeAd(form);
}

export async function repriceAd(_state: FormState, form: FormData): Promise<FormState> {
  return trade.repriceAd(form);
}

export async function chooseNickname(_state: FormState, form: FormData): Promise<FormState> {
  return trade.chooseNickname(form);
}
