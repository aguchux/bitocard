"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { StoreList, StoreReservedAccount, StoreWallet, StoreWalletConversion, StoreWalletCurrencyOption, StoreWalletTopUp } from "@bitocard/api-client/storefront";
import { parseMoney } from "@bitocard/api-client/storefront";
import type { FormState } from "@/lib/account-actions";
import { customerApi, siteOrigin } from "@/lib/customer";

const text = (form: FormData, name: string) => String(form.get(name) ?? "").trim();

/**
 * A money field's amount in minor units ("1,250.50" → 125050), read in the currency the field showed (its
 * `amount_currency`, else the form's `currency`); null when it is not an amount.
 */
const amountOf = (form: FormData, name = "amount") => parseMoney(text(form, name), text(form, "amount_currency") || text(form, "currency") || "USD");

/**
 * One of the signed-in customer's wallets: their own country's currency (chosen at sign-up and fixed) unless another
 * they hold is asked for. `wallets` lists them all. Null when signed out, before an older account has chosen its
 * country, or when the API cannot be reached.
 */
export async function walletFor(currency?: string): Promise<StoreWallet | null> {
  const result = await customerApi<StoreWallet>("GET", `/v1/store/wallet${currency ? `?${new URLSearchParams({ currency }).toString()}` : ""}`);
  return result.ok ? result.data : null;
}

/** Opens a payment page to top a wallet up (the country's, or `currency` USD); it returns to that wallet with the top-up's ID. */
export async function topUpWallet(_state: FormState, form: FormData): Promise<FormState> {
  const amount = amountOf(form);
  if (amount === null || amount < 100) return { error: "Enter an amount of at least 1.", field: "amount" };
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
  await customerApi("POST", `/v1/store/wallet/reserved-accounts/${encodeURIComponent(id)}/simulate-deposit`, { amount: amountOf(form) ?? 0 });
  revalidatePath("/account/wallet");
}


/** The currencies the customer could add as wallets (markets BitoCard opened for it). Empty when none, or unreachable. */
export async function walletCurrencies(): Promise<StoreWalletCurrencyOption[]> {
  const result = await customerApi<StoreList<StoreWalletCurrencyOption>>("GET", "/v1/store/wallet/currencies");
  return result.ok ? result.data.data : [];
}

/** Adds a wallet in another market's currency, then opens it. */
export async function addWallet(_state: FormState, form: FormData): Promise<FormState> {
  const currency = text(form, "currency").toUpperCase();
  const result = await customerApi<StoreWallet>("POST", "/v1/store/wallet/wallets", { currency });
  if (!result.ok) return { error: result.message, field: result.param };
  revalidatePath("/account", "layout");
  redirect(`/account/wallet?wallet=${encodeURIComponent(currency)}`);
}

/** Removes an added wallet with nothing in it, then shows the home wallet. */
export async function removeWallet(_state: FormState, form: FormData): Promise<FormState> {
  const currency = text(form, "currency").toUpperCase();
  const result = await customerApi<StoreWallet>("DELETE", `/v1/store/wallet/wallets/${encodeURIComponent(currency)}`);
  if (!result.ok) return { error: result.message, field: result.param };
  revalidatePath("/account", "layout");
  redirect("/account/wallet");
}

/** Moving money between wallets: first what arrives (`preview`), then the move itself at no less than that. */
export type ConversionState = FormState & { quote?: StoreWalletConversion; done?: StoreWalletConversion };

export async function convertWallets(_state: ConversionState, form: FormData): Promise<ConversionState> {
  const from = text(form, "from");
  const amount = parseMoney(text(form, "amount"), from || "USD");
  if (amount === null || amount < 1) return { error: "Enter the amount to move.", field: "amount" };
  const to = text(form, "to");
  if (!from || !to || from === to) return { error: "Choose two different wallets.", field: "to" };
  const expected = text(form, "expected");
  const preview = !expected;
  const result = await customerApi<StoreWalletConversion>("POST", "/v1/store/wallet/conversions", { from, to, amount, preview, ...(preview ? {} : { expected_amount: Number(expected) }) });
  if (!result.ok) return { error: result.message, field: result.code === "rate_changed" ? undefined : result.param };
  if (preview) return { quote: result.data };
  revalidatePath("/account", "layout");
  return { done: result.data, notice: "Moved." };
}
