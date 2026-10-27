import { randomUUID } from "node:crypto";
import type { StoreCryptoWithdrawal, StoreCustomerBankAccount, StoreCustomerPayout, StoreWithdrawalAddress } from "@bitocard/api-client/storefront";
import type { FormState, NonceFormState } from "./forms";
import { cryptoAmount, toMinor, type CustomerCall } from "./trade-actions";

/** Where an app's money pages are, and what else to refresh when money moves. */
export type MoneyPaths = {
  withdraw: string;
  /** The withdrawal's review, before anything moves (`?asset&chain&address&amount`). */
  withdrawConfirm: string;
  withdrawal: (id: string) => string;
  cashOut: string;
  /** Signing in first, coming back to `next`. */
  signIn: (next: string) => string;
  /** Layouts to refresh once money moves (balances shown elsewhere). */
  refresh: string[];
  /** Other pages showing the same bank accounts (the storefront's Shop tab pays Safe pay sales into them). */
  bankAccountsAlso?: string[];
};

const text = (form: FormData, name: string) => String(form.get(name) ?? "").trim();
const fresh = (state: FormState): NonceFormState => ({ ...state, nonce: randomUUID() });
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });

/**
 * The money actions' work (withdrawals, and cashing P2P money out to a bank), shared by the storefront's Crypto tab and
 * BitoCard Crypto: each app's own server actions call these with its customer API and its pages, and `redirect` and
 * `revalidatePath` passed in, as `tradeActions` does. A form that moves money sends its nonce as the Idempotency-Key,
 * and every refusal gives the form a fresh one (the API keeps a key's answer, so trying again must be a new request).
 */
export function moneyActions(deps: { api: CustomerCall; paths: MoneyPaths; redirect: (url: string) => never; revalidate: (path: string, type?: "layout" | "page") => void }) {
  const { api, paths, redirect } = deps;
  const page = (...pages: string[]) => pages.forEach(path => deps.revalidate(path));
  const layouts = () => paths.refresh.forEach(path => deps.revalidate(path, "layout"));
  const signInFirst = (status: number, next: string) => {
    if (status === 401) redirect(paths.signIn(next));
  };
  return {
    /** Saves an address to withdraw to (usable 24 hours later; the customer is emailed). */
    async addWithdrawalAddress(form: FormData): Promise<FormState> {
      const address = text(form, "address");
      const label = text(form, "label");
      if (!address) return { error: "Paste the address.", field: "address" };
      if (!label) return { error: "Give the address a name you will recognise.", field: "label" };
      const result = await api<StoreWithdrawalAddress>("POST", "/v1/store/crypto/withdrawal-addresses", { chain: text(form, "chain"), address, label });
      if (!result.ok) {
        signInFirst(result.status, paths.withdraw);
        return { error: result.message, field: result.param === "address" || result.param === "label" ? result.param : null };
      }
      page(paths.withdraw);
      return { notice: `Saved. You can send to "${result.data.label}" from ${when(result.data.usable_from)}.` };
    },

    async removeWithdrawalAddress(form: FormData): Promise<FormState> {
      const result = await api("DELETE", `/v1/store/crypto/withdrawal-addresses/${encodeURIComponent(text(form, "id"))}`);
      if (!result.ok) {
        signInFirst(result.status, paths.withdraw);
        return { error: result.message };
      }
      page(paths.withdraw);
      return {};
    },

    /** Checks the amount and goes to the review, where the customer sees the fee and total before anything moves. */
    async reviewWithdrawal(form: FormData): Promise<FormState> {
      const amount = cryptoAmount(text(form, "amount"));
      const addressId = text(form, "address_id");
      if (!addressId) return { error: "Choose where to send it.", field: "address_id" };
      if (!amount) return { error: "Enter how much to send.", field: "amount" };
      const body = { asset: text(form, "asset"), chain: text(form, "chain"), address_id: addressId, amount, preview: true };
      const result = await api("POST", "/v1/store/crypto/withdrawals", body);
      if (!result.ok) {
        signInFirst(result.status, paths.withdraw);
        return { error: result.message, field: result.param === "amount" ? "amount" : null };
      }
      return redirect(`${paths.withdrawConfirm}?${new URLSearchParams({ asset: body.asset, chain: body.chain, address: addressId, amount })}`);
    },

    /** Asks for the withdrawal: its amount and fee leave the wallet, and a code is emailed to confirm it. */
    async createWithdrawal(form: FormData): Promise<NonceFormState> {
      const body = { asset: text(form, "asset"), chain: text(form, "chain"), address_id: text(form, "address_id"), amount: text(form, "amount") };
      const result = await api<StoreCryptoWithdrawal>("POST", "/v1/store/crypto/withdrawals", body, { idempotencyKey: text(form, "nonce") || undefined });
      if (!result.ok) {
        signInFirst(result.status, paths.withdraw);
        return fresh({ error: result.message });
      }
      layouts();
      return redirect(paths.withdrawal(result.data.id));
    },

    /** The emailed code confirms the withdrawal. */
    async confirmWithdrawal(form: FormData): Promise<FormState> {
      const id = text(form, "id");
      const code = text(form, "code").replace(/\s/g, "");
      if (!/^\d{6}$/.test(code)) return { error: "Enter the 6-digit code we emailed you.", field: "code" };
      const result = await api<StoreCryptoWithdrawal>("POST", `/v1/store/crypto/withdrawals/${encodeURIComponent(id)}/confirm`, { code });
      if (!result.ok) return { error: result.message, field: "code" };
      page(paths.withdrawal(id));
      return { notice: result.data.status === "review" ? "Confirmed. BitoCard checks this withdrawal before it is sent." : "Confirmed. Your withdrawal is on its way." };
    },

    async resendWithdrawalCode(form: FormData): Promise<FormState> {
      const result = await api("POST", `/v1/store/crypto/withdrawals/${encodeURIComponent(text(form, "id"))}/resend-code`);
      if (!result.ok) return { error: result.message };
      return { notice: "A new code is on its way to your email." };
    },

    async cancelWithdrawal(form: FormData): Promise<FormState> {
      const id = text(form, "id");
      const result = await api("POST", `/v1/store/crypto/withdrawals/${encodeURIComponent(id)}/cancel`);
      if (!result.ok) {
        signInFirst(result.status, paths.withdrawal(id));
        return { error: result.message };
      }
      page(paths.withdrawal(id));
      layouts();
      return {};
    },

    /** Adds a bank account for P2P money (in the customer's verified name; usable after 24 hours on live stores). */
    async addCashOutAccount(form: FormData): Promise<FormState> {
      const bankCode = text(form, "bank_code");
      const accountNumber = text(form, "account_number").replace(/\s/g, "");
      if (!bankCode) return { error: "Choose your bank.", field: "bank_code" };
      if (!/^\d{6,20}$/.test(accountNumber)) return { error: "Enter your account number, digits only.", field: "account_number" };
      const result = await api<StoreCustomerBankAccount>("POST", "/v1/store/crypto/cash/bank-accounts", { bank_code: bankCode, account_number: accountNumber });
      if (!result.ok) {
        signInFirst(result.status, paths.cashOut);
        return { error: result.message, field: result.param === "account_number" || result.param === "bank_code" ? result.param : null };
      }
      page(paths.cashOut, ...(paths.bankAccountsAlso ?? []));
      return { notice: `Added ${result.data.bank_name} ending ${result.data.account_number_last4} (${result.data.account_name}).` };
    },

    async removeCashOutAccount(form: FormData): Promise<FormState> {
      const result = await api("DELETE", `/v1/store/crypto/cash/bank-accounts/${encodeURIComponent(text(form, "id"))}`);
      if (!result.ok) {
        signInFirst(result.status, paths.cashOut);
        return { error: result.message };
      }
      page(paths.cashOut);
      return {};
    },

    /** Pays P2P money out to one of the customer's bank accounts (the amount typed in their currency). */
    async cashOut(form: FormData): Promise<NonceFormState> {
      const amount = toMinor(text(form, "amount"));
      const account = text(form, "bank_account_id");
      if (!account) return { error: "Choose the account to pay into.", field: "bank_account_id" };
      if (!amount) return { error: "Enter how much to pay out.", field: "amount" };
      const result = await api<StoreCustomerPayout>("POST", "/v1/store/crypto/cash/payouts", { amount, bank_account_id: account }, { idempotencyKey: text(form, "nonce") || undefined });
      if (!result.ok) {
        signInFirst(result.status, paths.cashOut);
        return fresh({ error: result.message, field: result.param === "amount" ? "amount" : null });
      }
      page(paths.cashOut);
      layouts();
      // A fresh nonce: another payout from the same form is a new request.
      return fresh({ notice: result.data.status === "failed" ? `The bank refused it: ${result.data.failure_reason ?? "try another account"}. The money is back in your balance.` : "On its way to your bank." });
    },

    /** Sandbox only: settles a test payout as paid or failed. */
    async simulateCashOut(form: FormData): Promise<FormState> {
      const result = await api("POST", `/v1/store/crypto/cash/payouts/${encodeURIComponent(text(form, "id"))}/simulate`, { outcome: text(form, "outcome") === "failed" ? "failed" : "paid" });
      if (!result.ok) return { error: result.message };
      page(paths.cashOut);
      return {};
    },
  };
}
