"use client";

import { useActionState } from "react";
import { Send } from "lucide-react";
import { FormMessage, Submit, TextField } from "@/components/store/account-forms";
import type { FormState } from "@/lib/account-actions";
import { markDepositSent } from "@/lib/bank-deposits";

/** "I've sent it": how they paid, and the name on the slip or the account the transfer came from. */
export function DepositSentForm({ id, name }: { id: string; name: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(markDepositSent, {});
  if (state.notice) return <FormMessage state={state} />;
  return (
    <form action={action} className="space-y-4" aria-label="Tell us you paid">
      <FormMessage state={state} />
      <input type="hidden" name="id" value={id} />
      <fieldset>
        <legend className="text-sm font-semibold">How did you pay?</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {(
            [
              ["transfer", "Bank transfer", "From a bank app or online banking"],
              ["cash", "Cash deposit", "Paid in at the bank"],
            ] as const
          ).map(([value, label, hint], index) => (
            <label key={value} className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3 has-[:checked]:border-brand-500 has-[:checked]:bg-pink-50">
              <input type="radio" name="method" value={value} defaultChecked={index === 0} className="mt-1 accent-brand-500" />
              <span>
                <span className="block text-sm font-semibold">{label}</span>
                <span className="block text-xs text-slate-500">{hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <TextField label="Name the money came from" name="sender_name" required defaultValue={name} state={state} hint="The name on the deposit slip, or on the account you transferred from." />
      <TextField label="Anything else (optional)" name="note" maxLength={300} state={state} hint="For example the bank's transaction reference, or when you paid." />
      <Submit pending={pending} className="w-full sm:w-auto">
        <Send className="size-4" aria-hidden="true" /> I&apos;ve sent it
      </Submit>
    </form>
  );
}
