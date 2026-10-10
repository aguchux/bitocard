"use client";

import { useActionState } from "react";
import { Landmark, Plus } from "lucide-react";
import type { StorePaymentMethod } from "@bitocard/api-client/storefront";
import { FormMessage, Submit, TextField } from "@/components/store/account-forms";
import type { FormState } from "@/lib/account-actions";
import { openBankAccount, topUpWallet } from "@/lib/wallet";

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
