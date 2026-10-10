"use client";

import { useActionState, useEffect, useRef } from "react";
import { Landmark, Plus, X } from "lucide-react";
import type { StorePaymentMethod, StoreWallet } from "@bitocard/api-client/storefront";
import { FormMessage, Submit, TextField } from "@/components/store/account-forms";
import type { FormState } from "@/lib/account-actions";
import { openBankAccount, simulateDeposit, topUpWallet } from "@/lib/wallet";

/** Topping the wallet up: an amount, then the payment page of the method chosen. */
export function TopUpForm({ country, currency, methods, amount, sandbox }: { country: string | null; currency: string; methods: StorePaymentMethod[]; amount?: string; sandbox: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(topUpWallet, {});
  return (
    <form action={action} className="space-y-4" aria-label="Top up your wallet">
      {country ? <input type="hidden" name="country" value={country} /> : null}
      <FormMessage state={state} />
      <TextField label={`Amount (${currency})`} name="amount" inputMode="decimal" required defaultValue={amount} state={state} hint="Spent only in this store. Wallet money cannot be withdrawn." />
      {methods.length ? (
        <fieldset>
          <legend className="text-sm font-semibold">Pay with</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {methods.map((method, index) => (
              <label key={method.id} className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3 has-[:checked]:border-[#ff2382] has-[:checked]:bg-pink-50">
                <input type="radio" name="method" value={method.id} defaultChecked={index === 0} className="mt-1 accent-[#ff2382]" />
                <span>
                  <span className="block text-sm font-semibold">{method.label}</span>
                  <span className="block text-xs text-slate-500">{method.description}</span>
                  {method.networks.length ? (
                    <span className="mt-1.5 flex flex-wrap gap-1" aria-label={`Networks: ${method.networks.join(", ")}`}>
                      {method.networks.map(network => (
                        <span key={network} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                          {network}
                        </span>
                      ))}
                    </span>
                  ) : null}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : sandbox ? null : (
        <p className="text-sm text-slate-600">Card and mobile money top-ups are not open in your country yet.</p>
      )}
      <Submit pending={pending} className="w-full sm:w-auto">
        <Plus className="size-4" aria-hidden="true" /> {sandbox ? "Add test money" : "Continue to payment"}
      </Submit>
    </form>
  );
}

/** Opening the customer's own bank account number (Nigeria asks for the BVN, which goes to the bank only). */
export function BankAccountForm({ country, needsBvn }: { country: string | null; needsBvn: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(openBankAccount, {});
  return (
    <form action={action} className="space-y-4" aria-label="Get a bank account number">
      {country ? <input type="hidden" name="country" value={country} /> : null}
      <FormMessage state={state} />
      {needsBvn ? (
        <TextField label="BVN" name="bvn" inputMode="numeric" pattern="\d{11}" maxLength={11} required state={state} hint="The bank needs your BVN to open the account. We pass it on and do not keep it." />
      ) : null}
      <Submit pending={pending} className="w-full sm:w-auto">
        <Landmark className="size-4" aria-hidden="true" /> Get my account number
      </Submit>
    </form>
  );
}

/**
 * "Add funds" beside the balance: a popup (native dialog: Escape and the backdrop close it, focus stays inside) with
 * the ways to top up: card or mobile money through a payment page, and the customer's own bank account number where
 * the market offers one. Opens by itself when the customer came to top up for a purchase (`open`).
 */
export function AddFunds({ wallet, country, amount, open = false }: { wallet: StoreWallet; country: string | null; amount?: string; open?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
  }, [open]);
  const sandbox = wallet.mode === "test";
  return (
    <>
      <button
        type="button"
        onClick={() => dialog.current?.showModal()}
        className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-xl bg-[#ff2382] px-5 font-semibold text-white hover:bg-[#e8116d]"
      >
        <Plus className="size-5" aria-hidden="true" /> Add funds
      </button>
      <dialog
        ref={dialog}
        aria-labelledby="add-funds-title"
        onClick={event => event.target === dialog.current && dialog.current?.close()}
        className="m-auto max-h-[90dvh] w-[min(36rem,calc(100vw-2rem))] overflow-y-auto rounded-3xl bg-white p-0 text-[#070f4c] shadow-2xl backdrop:bg-[#070f4c]/50"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white px-5 py-3">
          <h2 id="add-funds-title" className="text-lg font-bold">
            Add funds
          </h2>
          <button type="button" aria-label="Close" onClick={() => dialog.current?.close()} className="grid size-11 place-items-center rounded-xl hover:bg-slate-50">
            <X className="size-6" aria-hidden="true" />
          </button>
        </div>
        <div className="space-y-6 p-5">
          <section aria-label="Pay now">
            <TopUpForm country={country} currency={wallet.currency} methods={wallet.top_up_methods} amount={amount} sandbox={sandbox} />
          </section>
          {wallet.reserved_accounts_available ? (
            <section aria-labelledby="add-bank" className="border-t border-slate-100 pt-5">
              <h3 id="add-bank" className="mb-1 flex items-center gap-2 font-semibold">
                <Landmark className="size-5" aria-hidden="true" /> Bank transfer
              </h3>
              <p className="mb-3 text-sm text-slate-600">Transfer to your own account number from any bank app: the money is added to your wallet once it arrives.</p>
              {wallet.reserved_accounts.length ? (
                <ul className="space-y-3">
                  {wallet.reserved_accounts.map(account => (
                    <li key={account.id} className="rounded-2xl bg-slate-50 p-4">
                      <p className="font-display text-2xl font-extrabold tracking-wide">{account.account_number}</p>
                      <p className="text-sm text-slate-600">
                        {account.bank_name} · {account.account_name}
                      </p>
                      {sandbox ? (
                        <form action={simulateDeposit} className="mt-3 flex flex-wrap items-center gap-2">
                          <input type="hidden" name="id" value={account.id} />
                          <input name="amount" defaultValue="5000" inputMode="decimal" aria-label="Test transfer amount" className="min-h-10 w-28 rounded-xl border border-slate-200 bg-white px-3" />
                          <button type="submit" className="min-h-10 rounded-xl bg-white px-3 font-semibold ring-1 ring-slate-200 hover:ring-slate-300">
                            Simulate a transfer
                          </button>
                        </form>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <BankAccountForm country={country} needsBvn={wallet.reserved_account_needs_bvn} />
              )}
            </section>
          ) : null}
        </div>
      </dialog>
    </>
  );
}
