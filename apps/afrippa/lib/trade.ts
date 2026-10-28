"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FormState } from "@afrippa/ui/forms";
import { tradeActions } from "@afrippa/ui/trade-actions";
import { customerApi, signInPath } from "@/lib/customer";

/**
 * Afrippa's trading actions: the work is `@bitocard/crypto-ui`'s (`tradeActions`, shared with the storefront's
 * Crypto tab), over this site's own customer session and on its own pages.
 */
const trade = tradeActions({
  api: customerApi,
  paths: { ads: "/ads", signIn: next => signInPath(next, "trade"), refresh: ["/"] },
  redirect,
  revalidate: revalidatePath,
});

export async function declareCrypto(form: FormData): Promise<void> {
  return trade.declare(form);
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
