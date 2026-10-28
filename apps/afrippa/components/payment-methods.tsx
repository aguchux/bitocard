"use client";

import { useActionState, useState } from "react";
import { Field, FormMessage, type FormState, Submit } from "@afrippa/ui/forms";
import { addPaymentMethod, removePaymentMethod } from "@/lib/orders";
import { kindNames, namedServices, type PaymentMethodKind } from "@/lib/orders-types";
import { ConfirmCode, type TwoStepMethod } from "@/components/confirm-code";

const selectClass = "min-h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-[15px] text-navy-900 focus:border-navy-900 focus:ring-2 focus:ring-navy-900/15";

/**
 * Adding where the trader is paid. The account must be in their own verified name (the API sets it, never typed here);
 * a new one can be used 24 hours after it is added, and every addition is emailed to them.
 */
export function AddPaymentMethodForm({ currencies, nonce, method }: { currencies: string[]; nonce: string; method: TwoStepMethod }) {
  const [kind, setKind] = useState<PaymentMethodKind>("bank");
  const [state, action, pending] = useActionState<FormState, FormData>(addPaymentMethod, {});
  return (
    <form action={action} className="space-y-4" aria-label="Add a payment method">
      <input type="hidden" name="nonce" value={nonce} />
      <FormMessage state={state} />
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">What kind of account</legend>
        <div className="grid grid-cols-3 gap-2">
          {(Object.keys(kindNames) as PaymentMethodKind[]).map(value => (
            <label
              key={value}
              className="flex min-h-12 cursor-pointer items-center justify-center rounded-xl border border-slate-200 px-2 text-center text-sm font-semibold has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50 has-[:checked]:text-brand-700"
            >
              <input className="sr-only" type="radio" name="kind" value={value} checked={kind === value} onChange={() => setKind(value)} />
              {kindNames[value]}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="block space-y-1.5 text-sm font-semibold">
        Currency
        <select name="currency" className={selectClass} defaultValue={currencies[0]}>
          {currencies.map(currency => (
            <option key={currency}>{currency}</option>
          ))}
        </select>
      </label>
      {kind === "bank" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Bank" name="bank_name" maxLength={80} required state={state} />
          <Field label="Account number" name="account_number" inputMode="numeric" maxLength={24} required state={state} />
          <Field label="Bank code (optional)" name="bank_code" maxLength={20} state={state} hint="A sort code, routing number or branch code, if buyers need it." />
        </div>
      ) : kind === "mobile_money" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Network" name="network" maxLength={40} placeholder="MTN, M-Pesa…" required state={state} />
          <Field label="Wallet's mobile number" name="phone" type="tel" inputMode="tel" maxLength={20} required state={state} hint="A mobile number of your country." />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1.5 text-sm font-semibold">
            Service
            <select name="provider" className={selectClass} required defaultValue="">
              <option value="" disabled>
                Choose a service
              </option>
              {namedServices.map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <Field label="Where you are paid" name="handle" maxLength={120} placeholder="Email, username or account ID" required state={state} />
        </div>
      )}
      <p className="text-xs text-slate-500">The account must be in your own name. Buyers see its details only inside an order with you. You can use it 24 hours after adding it.</p>
      <ConfirmCode method={method} state={state} />
      <Submit pending={pending}>Save payment method</Submit>
    </form>
  );
}

export function RemovePaymentMethod({ id, label }: { id: string; label: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(removePaymentMethod, {});
  return (
    <form action={action} className="inline-flex flex-col items-end gap-1">
      <input type="hidden" name="id" value={id} />
      <button type="submit" disabled={pending} aria-label={`Remove ${label}`} className="min-h-11 rounded-xl px-3 text-sm font-semibold text-red-700 ring-1 ring-red-200 hover:ring-red-300 disabled:opacity-60">
        Remove
      </button>
      {state.error ? (
        <p className="max-w-xs text-sm text-red-700" role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
