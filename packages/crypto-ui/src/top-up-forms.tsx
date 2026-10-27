"use client";

import { useActionState } from "react";
import { Landmark, Plus } from "lucide-react";
import type { StorePaymentMethod } from "@bitocard/api-client/storefront";
import { Field, FormMessage, type FormState, Submit } from "./forms";

type Action = (state: FormState, form: FormData) => Promise<FormState>;

/** Topping a wallet up: an amount, then the payment page of the method chosen. `action` is the app's server action. */
export function TopUpForm({
  action,
  currency,
  primary = true,
  methods,
  amount,
  sandbox,
  hint = "Spent only in this store. Wallet money cannot be withdrawn.",
}: {
  action: Action;
  currency: string;
  primary?: boolean;
  methods: StorePaymentMethod[];
  amount?: string;
  sandbox: boolean;
  hint?: string;
}) {
  const [state, run, pending] = useActionState<FormState, FormData>(action, {});
  return (
    <form action={run} className="space-y-4" aria-label="Top up your wallet">
      <FormMessage state={state} />
      {primary ? null : <input type="hidden" name="currency" value={currency} />}
      <Field label={`Amount (${currency})`} name="amount" inputMode="decimal" required defaultValue={amount} state={state} hint={hint} />
      {methods.length ? (
        <fieldset>
          <legend className="text-sm font-semibold">Pay with</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {methods.map((method, index) => (
              <label key={method.id} className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3 has-[:checked]:border-brand-500 has-[:checked]:bg-pink-50">
                <input type="radio" name="method" value={method.id} defaultChecked={index === 0} className="mt-1 accent-brand-500" />
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
        <p className="text-sm text-slate-600">{primary ? "Card and mobile money top-ups are not open in your country yet." : "US dollar top-ups are not open in your country yet."}</p>
      )}
      <Submit pending={pending} className="w-full sm:w-auto">
        <Plus className="size-4" aria-hidden="true" /> {sandbox ? "Add test money" : "Continue to payment"}
      </Submit>
    </form>
  );
}

/** Opening the customer's own bank account number (Nigeria asks for the BVN, which goes to the bank only). */
export function BankAccountForm({ action, needsBvn }: { action: Action; needsBvn: boolean }) {
  const [state, run, pending] = useActionState<FormState, FormData>(action, {});
  return (
    <form action={run} className="space-y-4" aria-label="Get a bank account number">
      <FormMessage state={state} />
      {needsBvn ? (
        <Field label="BVN" name="bvn" inputMode="numeric" pattern="\d{11}" maxLength={11} required state={state} hint="The bank needs your BVN to open the account. We pass it on and do not keep it." />
      ) : null}
      <Submit pending={pending} className="w-full sm:w-auto">
        <Landmark className="size-4" aria-hidden="true" /> Get my account number
      </Submit>
    </form>
  );
}
