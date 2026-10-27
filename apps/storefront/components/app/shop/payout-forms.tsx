"use client";

import { type ReactNode, useActionState } from "react";
import { Plus, Send, Trash2 } from "lucide-react";
import { FormMessage, Submit, TextField } from "@/components/store/account-forms";
import type { FormState } from "@/lib/account-actions";
import { addPayoutAccount, type NonceFormState, payOut, removePayoutAccount, simulatePayout } from "@/lib/payout-actions";

const selectClass = "min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-navy-900 focus:border-brand-500 focus:ring-2 focus:ring-pink-100 focus:outline-none";

/** One button that changes something, with the API's reason beside it when it is refused. */
function ActionButton({ action, fields, children, className, label }: { action: (state: FormState, form: FormData) => Promise<FormState>; fields: Record<string, string>; children: ReactNode; className: string; label?: string }) {
  const [state, run, pending] = useActionState<FormState, FormData>(action, {});
  return (
    <form action={run} className="inline-flex flex-col items-start gap-1">
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <button type="submit" disabled={pending} aria-label={label} className={`${className} disabled:opacity-60`}>
        {children}
      </button>
      {state.error ? (
        <p className="max-w-xs text-sm text-red-700" role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

/** Adds a bank account to be paid into: the bank names its holder, who must be the customer. */
export function PayoutAccountForm({ banks }: { banks: Array<{ code: string; name: string }> }) {
  const [state, action, pending] = useActionState<FormState, FormData>(addPayoutAccount, {});
  return (
    <form action={action} className="space-y-3" aria-label="Add a bank account">
      <FormMessage state={state} />
      <label className="block space-y-1.5">
        <span className="block text-sm font-semibold text-navy-900">Bank</span>
        <select name="bank_code" required defaultValue="" className={selectClass} aria-invalid={state.field === "bank_code" || undefined}>
          <option value="" disabled>
            Choose your bank
          </option>
          {banks.map(bank => (
            <option key={bank.code} value={bank.code}>
              {bank.name}
            </option>
          ))}
        </select>
      </label>
      <TextField label="Account number" name="account_number" inputMode="numeric" autoComplete="off" required state={state} hint="It must be in your own name, as your identity check shows it." />
      <Submit pending={pending} className="w-full sm:w-auto">
        <Plus className="size-4" aria-hidden="true" /> Add bank account
      </Submit>
    </form>
  );
}

/** Pays the money from the customer's sales into one of their bank accounts. */
export function PayOutForm({ accounts, currency, available, nonce }: { accounts: Array<{ id: string; label: string; ready: boolean; from: string }>; currency: string; available: string; nonce: string }) {
  const [state, action, pending] = useActionState<NonceFormState, FormData>(payOut, {});
  const usable = accounts.filter(item => item.ready);
  return (
    <form action={action} className="space-y-4" aria-label="Pay out">
      {/* Sent as the Idempotency-Key, so a double tap pays out once. */}
      <input type="hidden" name="nonce" value={state.nonce ?? nonce} />
      <FormMessage state={state} />
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-semibold text-navy-900">Pay into</legend>
        {accounts.map(item => (
          <label key={item.id} className={`flex min-h-12 items-center gap-3 rounded-xl px-3 py-2 ring-1 ring-slate-200 has-[:checked]:bg-pink-50 has-[:checked]:ring-2 has-[:checked]:ring-brand-500 ${item.ready ? "cursor-pointer" : "opacity-60"}`}>
            <input type="radio" name="bank_account_id" value={item.id} disabled={!item.ready} defaultChecked={item.id === usable[0]?.id} className="accent-brand-500" />
            <span className="min-w-0">
              <span className="block font-semibold">{item.label}</span>
              {!item.ready ? <span className="block text-xs text-amber-700">Usable from {item.from}</span> : null}
            </span>
          </label>
        ))}
      </fieldset>
      <TextField label={`Amount (${currency})`} name="amount" inputMode="decimal" required state={state} hint={`You can pay out ${available} now.`} />
      <Submit pending={pending} className="w-full">
        <Send className="size-4" aria-hidden="true" /> Pay out to my bank
      </Submit>
    </form>
  );
}

export function RemovePayoutAccount({ id, label }: { id: string; label: string }) {
  return (
    <ActionButton action={removePayoutAccount} fields={{ id }} label={`Remove ${label}`} className="inline-flex size-11 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 hover:text-red-700">
      <Trash2 className="size-4" aria-hidden="true" />
    </ActionButton>
  );
}

/** Sandbox only: settles a test payout as paid or failed. */
export function SimulatePayout({ id }: { id: string }) {
  return (
    <span className="flex w-full gap-2">
      {(["paid", "failed"] as const).map(outcome => (
        <ActionButton key={outcome} action={simulatePayout} fields={{ id, outcome }} className="inline-flex min-h-10 items-center rounded-xl px-3 text-sm font-semibold ring-1 ring-amber-300 hover:bg-amber-50">
          Test: {outcome === "paid" ? "pay it" : "fail it"}
        </ActionButton>
      ))}
    </span>
  );
}
