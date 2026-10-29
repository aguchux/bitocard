"use client";

import { useActionState } from "react";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { FormMessage, type FormState, Submit } from "@afrippa/ui/forms";
import { applyMerchant, blockTrader, giveFeedback, reportTrader, unblockTrader } from "@/lib/orders";
import { reportReasons } from "@/lib/orders-types";

const quiet = "inline-flex min-h-11 items-center justify-center rounded-xl px-4 text-sm font-semibold ring-1 ring-slate-300 hover:ring-slate-400 disabled:opacity-60";

/** Applying to be a merchant, once every requirement is met. */
export function ApplyMerchant() {
  const [state, action, pending] = useActionState<FormState, FormData>(applyMerchant, {});
  return (
    <form action={action} className="space-y-3">
      <FormMessage state={state} />
      {state.notice ? null : <Submit pending={pending}>Apply to be a merchant</Submit>}
    </form>
  );
}

/** Rating the other trader once an order is released: positive or negative, and a short comment without contact details. */
export function FeedbackForm({ orderId, other }: { orderId: string; other: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(giveFeedback, {});
  if (state.notice) return <FormMessage state={state} />;
  return (
    <form action={action} className="space-y-3" aria-label={`Rate ${other}`}>
      <input type="hidden" name="id" value={orderId} />
      <FormMessage state={state} />
      <fieldset className="grid grid-cols-2 gap-2">
        <legend className="mb-2 text-sm font-semibold">How was trading with {other}?</legend>
        {(
          [
            ["positive", "Good", ThumbsUp],
            ["negative", "Bad", ThumbsDown],
          ] as const
        ).map(([value, label, Icon]) => (
          <label key={value} className="flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-xl border border-slate-200 text-sm font-semibold has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50 has-[:checked]:text-brand-700">
            <input type="radio" name="rating" value={value} required className="sr-only" />
            <Icon className="size-4" aria-hidden="true" /> {label}
          </label>
        ))}
      </fieldset>
      <label className="block space-y-1.5 text-sm font-semibold">
        Comment (optional)
        <textarea name="comment" maxLength={300} rows={2} aria-invalid={state.field === "comment" || undefined} className="w-full rounded-xl border border-slate-200 p-3 text-[15px] font-normal" />
      </label>
      <p className="text-xs text-slate-500">Shown on their card with your nickname. No links, emails, handles or phone numbers.</p>
      <Submit pending={pending}>Send feedback</Submit>
    </form>
  );
}

/** Blocking a trader (or unblocking one): neither sees the other's ads. */
export function BlockButton({ nickname, blocked = false }: { nickname: string; blocked?: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(blocked ? unblockTrader : blockTrader, {});
  return (
    <form action={action} className="inline-flex flex-col items-start gap-1">
      <input type="hidden" name="nickname" value={nickname} />
      <button type="submit" disabled={pending} className={blocked ? quiet : `${quiet} text-red-700 ring-red-200 hover:ring-red-300`}>
        {blocked ? `Unblock ${nickname}` : `Block ${nickname}`}
      </button>
      {state.error || state.notice ? (
        <p className={`text-sm ${state.error ? "text-red-700" : "text-emerald-700"}`} role={state.error ? "alert" : "status"}>
          {state.error ?? state.notice}
        </p>
      ) : null}
    </form>
  );
}

/** Reporting a trader to Afrippa's team, optionally about one order between them. */
export function ReportForm({ nickname, orderId }: { nickname: string; orderId?: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(reportTrader, {});
  if (state.notice) return <FormMessage state={state} />;
  return (
    <details className="rounded-2xl ring-1 ring-slate-200">
      <summary className="flex min-h-12 cursor-pointer items-center px-4 font-semibold">Report {nickname}</summary>
      <form action={action} className="space-y-3 px-4 pb-4" aria-label={`Report ${nickname}`}>
        <input type="hidden" name="nickname" value={nickname} />
        {orderId ? <input type="hidden" name="order_id" value={orderId} /> : null}
        <FormMessage state={state} />
        <label className="block space-y-1.5 text-sm font-semibold">
          What happened
          <select name="reason" required defaultValue="" className="min-h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-[15px] font-normal">
            <option value="" disabled>
              Choose a reason
            </option>
            {reportReasons.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1.5 text-sm font-semibold">
          Tell us more
          <textarea name="details" required minLength={10} maxLength={2000} rows={4} aria-invalid={state.field === "details" || undefined} className="w-full rounded-xl border border-slate-200 p-3 text-[15px] font-normal" />
        </label>
        <p className="text-xs text-slate-500">Afrippa&apos;s team reads it with the order room. An upheld report is a strike against them.</p>
        <Submit pending={pending}>Send the report</Submit>
      </form>
    </details>
  );
}
