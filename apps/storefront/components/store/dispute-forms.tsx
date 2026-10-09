"use client";

import { useActionState, useId } from "react";
import type { FormState } from "@/lib/account-actions";
import { openDispute, replyToDispute } from "@/lib/dispute-actions";
import { FormMessage, Submit, TextField } from "@/components/store/account-forms";

const empty: FormState = {};
const areaClass = "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-[15px] text-[#070f4c] focus:border-[#070f4c] focus:ring-2 focus:ring-[#070f4c]/15 aria-[invalid=true]:border-red-400";

function MessageField({ label, name, state, hint }: { label: string; name: string; state: FormState; hint?: string }) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-semibold text-[#070f4c]">
        {label}
      </label>
      <textarea id={id} name={name} rows={5} required minLength={3} maxLength={5000} className={areaClass} aria-invalid={state.field === name || undefined} />
      {hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

/** Report a problem with an order: the store answers first and can pass it to BitoCard. */
export function DisputeForm({ checkoutId }: { checkoutId: string }) {
  const [state, action, pending] = useActionState(openDispute, empty);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="checkout_id" value={checkoutId} />
      <FormMessage state={state} />
      <TextField label="What is wrong?" name="subject" state={state} required minLength={3} maxLength={200} placeholder="For example: my code does not work" />
      <MessageField label="Tell us what happened" name="message" state={state} hint="Include anything that helps: what you tried, any error you saw." />
      <Submit pending={pending}>Send to the store</Submit>
    </form>
  );
}

/** A reply on an open dispute. */
export function DisputeReplyForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState(replyToDispute, empty);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      <FormMessage state={state} />
      <MessageField label="Your reply" name="body" state={state} />
      <Submit pending={pending}>Send</Submit>
    </form>
  );
}
