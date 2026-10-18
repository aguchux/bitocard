"use client";

import { useActionState, useId } from "react";
import type { FormState } from "@/lib/account-actions";
import { closeTicket, openTicket, replyToTicket } from "@/lib/support-actions";
import { ticketCategories } from "@/lib/support";
import { FormMessage, Submit, TextField } from "@/components/store/account-forms";

const empty: FormState = {};
const fieldClass = "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-[15px] text-navy-900 focus:border-navy-900 focus:ring-2 focus:ring-navy-900/15 aria-[invalid=true]:border-red-400";

function MessageField({ label, name, state, hint }: { label: string; name: string; state: FormState; hint?: string }) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-semibold text-navy-900">
        {label}
      </label>
      <textarea id={id} name={name} rows={5} required minLength={3} maxLength={5000} className={fieldClass} aria-invalid={state.field === name || undefined} />
      {hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

/** Ask the store a question; about an order when `checkoutId` is given. */
export function TicketForm({ checkoutId }: { checkoutId?: string }) {
  const id = useId();
  const [state, action, pending] = useActionState(openTicket, empty);
  return (
    <form action={action} className="space-y-4">
      {checkoutId ? <input type="hidden" name="checkout_id" value={checkoutId} /> : null}
      <FormMessage state={state} />
      <div className="space-y-1.5">
        <label htmlFor={`${id}-category`} className="block text-sm font-semibold text-navy-900">
          What is it about?
        </label>
        <select id={`${id}-category`} name="category" defaultValue={checkoutId ? "order" : "other"} className={fieldClass} aria-invalid={state.field === "category" || undefined}>
          {ticketCategories.map(item => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </div>
      <TextField label="Subject" name="subject" state={state} required minLength={3} maxLength={200} placeholder="For example: how do I redeem my gift card?" />
      <MessageField label="Your question" name="message" state={state} hint="Include anything that helps us answer: what you tried, any error you saw. Never send codes, PINs or passwords." />
      <Submit pending={pending}>Send to the store</Submit>
    </form>
  );
}

/** A reply on a ticket (a resolved one reopens). */
export function TicketReplyForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState(replyToTicket, empty);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      <FormMessage state={state} />
      <MessageField label="Your reply" name="body" state={state} />
      <Submit pending={pending}>Send</Submit>
    </form>
  );
}

/** "I have my answer": resolves the ticket. */
export function CloseTicketButton({ id }: { id: string }) {
  const [state, action, pending] = useActionState(closeTicket, empty);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      <FormMessage state={state} />
      <button type="submit" disabled={pending} className="inline-flex min-h-11 items-center rounded-xl border border-slate-200 px-4 font-semibold text-navy-900 hover:border-slate-300 disabled:opacity-60">
        {pending ? "Closing…" : "I have my answer: close this ticket"}
      </button>
    </form>
  );
}
