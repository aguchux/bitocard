import type { StoreReservedAccount, StoreWalletTopUp } from "@bitocard/api-client/storefront";
import type { FormState } from "./forms";
import type { CustomerCall } from "./trade-actions";

/** Where an app's wallet page is, and how it signs people in. */
export type TopUpPaths = {
  /** The wallet page top-ups return to (`?wallet=USD` for the dollar wallet, `top_up` added). */
  wallet: string;
  /** This site's origin, which the payment page returns to. */
  origin: () => string | Promise<string>;
  signIn: (next: string) => string;
  /** Confirming the email first. */
  verifyEmail: (next: string) => string;
};

const text = (form: FormData, name: string) => String(form.get(name) ?? "").trim();

/**
 * Adding money to a customer's wallets (top-ups by card or mobile money through a payment page, and their own bank
 * account number), shared by the storefront's Wallet tab and BitoCard Crypto: each app's own server actions call these
 * with its customer API and its wallet page, and `redirect` and `revalidatePath` passed in, as `tradeActions` does.
 */
export function topUpActions(deps: { api: CustomerCall; paths: TopUpPaths; redirect: (url: string) => never; revalidate: (path: string) => void }) {
  const { api, paths, redirect } = deps;
  return {
    /** Opens a payment page to top a wallet up (the country's, or `currency` USD); it returns to that wallet with the top-up's ID. */
    async topUp(form: FormData): Promise<FormState> {
      const amount = Math.round(Number(text(form, "amount").replace(/[,\s]/g, "")) * 100);
      if (!Number.isFinite(amount) || amount < 100) return { error: "Enter an amount of at least 1.", field: "amount" };
      const currency = text(form, "currency") || undefined;
      const back = new URL(`${await paths.origin()}${paths.wallet}`);
      if (currency) back.searchParams.set("wallet", currency);
      const result = await api<StoreWalletTopUp>("POST", "/v1/store/wallet/top-ups", { amount, method: text(form, "method") || undefined, return_url: back.toString(), currency });
      if (!result.ok) {
        if (result.status === 401) redirect(paths.signIn(paths.wallet));
        if (result.code === "email_not_verified") redirect(paths.verifyEmail(paths.wallet));
        return { error: result.message, field: result.param };
      }
      // Live: to the payment page. The sandbox has none: the wallet page simulates it.
      if (result.data.mode === "live" && result.data.checkout_url) return redirect(result.data.checkout_url);
      return redirect(`${paths.wallet}?${new URLSearchParams({ ...(currency ? { wallet: currency } : {}), top_up: result.data.id })}`);
    },

    /** Opens the customer's own bank account number for the wallet (Nigeria asks for the BVN, passed to the bank only). */
    async openBankAccount(form: FormData): Promise<FormState> {
      const result = await api<{ data: StoreReservedAccount[] }>("POST", "/v1/store/wallet/reserved-accounts", { bvn: text(form, "bvn") || undefined });
      if (!result.ok) return { error: result.message, field: result.param };
      deps.revalidate(paths.wallet);
      return { notice: "Your account number is ready. Transfers into it top up your wallet." };
    },

    /**
     * The customer gave up on a top-up's payment page: it is closed, so the waiting notice goes. Paid after all, it is
     * credited and shown as added instead. `back` is the wallet tab they were on (only this app's wallet page).
     */
    async cancelTopUp(form: FormData): Promise<void> {
      const id = text(form, "id");
      const back = text(form, "back");
      const target = new URL(back.startsWith(paths.wallet) ? back : paths.wallet, "https://site.invalid");
      const result = await api<StoreWalletTopUp>("POST", `/v1/store/wallet/top-ups/${encodeURIComponent(id)}/cancel`, {});
      deps.revalidate(paths.wallet);
      if (!result.ok) {
        target.searchParams.set("top_up", id);
        target.searchParams.set("cancel_error", result.code ?? "unavailable");
      } else if (result.data.status === "succeeded") {
        target.searchParams.set("top_up", id);
      }
      redirect(`${target.pathname}${target.search}`);
    },

    /** Sandbox stores only: finish a top-up as paid or failed. */
    async simulateTopUp(form: FormData): Promise<void> {
      await api("POST", `/v1/store/wallet/top-ups/${encodeURIComponent(text(form, "id"))}/simulate`, { outcome: text(form, "outcome") });
      deps.revalidate(paths.wallet);
    },

    /** Sandbox stores only: a transfer into the customer's account number. */
    async simulateDeposit(form: FormData): Promise<void> {
      await api("POST", `/v1/store/wallet/reserved-accounts/${encodeURIComponent(text(form, "id"))}/simulate-deposit`, { amount: Math.round(Number(text(form, "amount")) * 100) });
      deps.revalidate(paths.wallet);
    },
  };
}

/** Why a payment could not be cancelled (`?cancel_error=<code>` after the cancel action), as the page says it. */
const cancelErrors: Record<string, string> = {
  payment_in_progress: "This payment has been made and is still being confirmed, so it cannot be cancelled. We will confirm it shortly.",
};

export const cancelErrorText = (code: string) => cancelErrors[code] ?? "We could not cancel this payment just now. Try again in a minute.";
