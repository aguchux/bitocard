"use client";

import { useActionState, useRef } from "react";
import { FormMessage, type FormState, Submit } from "@afrippa/ui/forms";
import { openTicket, replyToTicket } from "@/lib/help";

const field = "w-full rounded-xl border border-slate-200 bg-white p-3 text-[15px] font-normal text-navy-900";

/** What a ticket is about, in the API's categories. */
const categories: Array<[string, string]> = [
  ["order", "An order"],
  ["payment", "A payment method or payment"],
  ["account", "My account or signing in"],
  ["technical", "Something not working"],
  ["other", "Something else"],
];

/** A new question to Afrippa's team: a title, what it is about and the message. */
export function NewTicketForm({ nonce }: { nonce: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(openTicket, {});
  return (
    <form action={action} className="space-y-3" aria-label="Ask Afrippa's team">
      <input type="hidden" name="nonce" value={nonce} />
      <FormMessage state={state} />
      <label className="block space-y-1.5 text-sm font-semibold">
        Title
        <input name="subject" required minLength={3} maxLength={200} aria-invalid={state.field === "subject" || undefined} className={`${field} min-h-12`} />
      </label>
      <label className="block space-y-1.5 text-sm font-semibold">
        It is about
        <select name="category" defaultValue="order" className={`${field} min-h-12`}>
          {categories.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="block space-y-1.5 text-sm font-semibold">
        Your message
        <textarea name="message" required minLength={3} maxLength={5000} rows={5} aria-invalid={state.field === "message" || undefined} className={field} />
      </label>
      <p className="text-xs text-slate-500">Never send passwords, codes or recovery codes: Afrippa&apos;s team never asks for them. A problem with an order&apos;s payment is settled by appealing the order.</p>
      <Submit pending={pending}>Send to Afrippa</Submit>
    </form>
  );
}

/** Replying on a ticket (a resolved one reopens). */
export function TicketReplyForm({ id }: { id: string }) {
  const form = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState<FormState, FormData>(async (previous, data) => {
    const answer = await replyToTicket(previous, data);
    if (answer.notice) form.current?.reset();
    return answer;
  }, {});
  return (
    <form ref={form} action={action} className="space-y-2" aria-label="Reply">
      <input type="hidden" name="id" value={id} />
      <FormMessage state={state.error ? state : {}} />
      <label className="sr-only" htmlFor="ticket-reply">
        Reply
      </label>
      <textarea id="ticket-reply" name="body" required maxLength={5000} rows={3} placeholder="Write a reply" className={field} />
      <Submit pending={pending}>Send</Submit>
    </form>
  );
}
