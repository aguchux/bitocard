"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Paperclip, Send } from "lucide-react";
import { FormMessage, type FormState, type NonceFormState, Submit } from "@afrippa/ui/forms";
import { appealOrder, cancelOrder, markPaid, openOrder, releaseOrder, roomSince, type RoomState, sendToRoom } from "@/lib/orders";
import type { OrderMessage } from "@/lib/orders-types";
import { ConfirmCode, type TwoStepMethod } from "@/components/confirm-code";

/** Refreshes an open order's page every 10 seconds while it is shown, so its steps follow the other side's. */
export function AutoRefresh() {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) router.refresh();
    }, 10_000);
    return () => clearInterval(timer);
  }, [router]);
  return null;
}

/** The time left to pay, counting down each second (a minute's precision would mislead near the end). */
export function TimeLeft({ until }: { until: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const left = Math.max(0, new Date(until).getTime() - now);
  const minutes = Math.floor(left / 60_000);
  const seconds = Math.floor((left % 60_000) / 1000);
  return <span className="font-mono tabular-nums">{left ? `${minutes}:${String(seconds).padStart(2, "0")}` : "time is up"}</span>;
}

const quiet = "inline-flex min-h-12 items-center justify-center rounded-xl px-4 font-semibold ring-1 ring-slate-300 hover:ring-slate-400 disabled:opacity-60";

/** Opening the order previewed: the coins go into escrow at once, and the payment window starts. */
export function OpenOrderForm({ adId, price, fiat, methodId, nonce, label }: { adId: string; price: number; fiat: string; methodId: string; nonce: string; label: string }) {
  const [state, action, pending] = useActionState<NonceFormState, FormData>(openOrder, { nonce });
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="ad_id" value={adId} />
      <input type="hidden" name="price" value={price} />
      <input type="hidden" name="fiat" value={fiat} />
      <input type="hidden" name="payment_method_id" value={methodId} />
      <input type="hidden" name="nonce" value={state.nonce ?? nonce} />
      <FormMessage state={state} />
      <Submit pending={pending} className="w-full sm:w-auto">
        {label}
      </Submit>
    </form>
  );
}

/** The buyer marks the order paid, naming the account they paid from (their own, in their name). */
export function MarkPaidForm({ id, methods }: { id: string; methods: Array<{ id: string; label: string; hint: string }> }) {
  const [state, action, pending] = useActionState<FormState, FormData>(markPaid, {});
  if (!methods.length) return <p className="text-sm text-slate-600">Add the account you pay from in Payment methods first: it must be in your own name.</p>;
  return (
    <form action={action} className="space-y-3" aria-label="I have paid">
      <input type="hidden" name="id" value={id} />
      <FormMessage state={state} />
      <label className="block space-y-1.5 text-sm font-semibold">
        I paid from
        <select name="payment_method_id" required defaultValue={methods.length === 1 ? methods[0].id : ""} className="min-h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-[15px]">
          <option value="" disabled>
            Choose your account
          </option>
          {methods.map(method => (
            <option key={method.id} value={method.id}>
              {method.label} {method.hint}
            </option>
          ))}
        </select>
      </label>
      <Submit pending={pending}>I have paid</Submit>
    </form>
  );
}

/** The seller releases the coins, only once they checked the money arrived from the buyer's own name. */
export function ReleaseForm({ id, payerName, warning, method }: { id: string; payerName: string; warning: boolean; method: TwoStepMethod }) {
  const [state, action, pending] = useActionState<FormState, FormData>(releaseOrder, {});
  return (
    <form action={action} className="space-y-3" aria-label="Release the coins">
      <input type="hidden" name="id" value={id} />
      <FormMessage state={state} />
      {warning ? <p className="rounded-xl bg-amber-50 px-3.5 py-3 text-sm text-amber-900">This payment can be taken back by the payer after you release. Release only once you are sure it has settled.</p> : null}
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" name="payer_checked" value="yes" required className="mt-1 size-4" />
        <span>
          I checked my account: the money arrived, in full, from an account in the name <strong>{payerName}</strong>.
        </span>
      </label>
      <ConfirmCode method={method} state={state} />
      <Submit pending={pending}>Release the coins</Submit>
    </form>
  );
}

/** The buyer cancels: the coins go back to the seller. Repeated cancelling limits buying for a day. */
export function CancelForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(cancelOrder, {});
  return (
    <form action={action} className="space-y-3" aria-label="Cancel the order">
      <input type="hidden" name="id" value={id} />
      <FormMessage state={state} />
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" name="confirm" value="yes" required className="mt-1 size-4" />
        <span>I have not paid, and will not pay, for this order.</span>
      </label>
      <button type="submit" disabled={pending} className={`${quiet} text-red-700 ring-red-200 hover:ring-red-300`}>
        Cancel the order
      </button>
    </form>
  );
}

/** Either side asks Afrippa's team to decide (once the order is marked paid); the coins stay in escrow meanwhile. */
export function AppealForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(appealOrder, {});
  return (
    <details className="rounded-2xl ring-1 ring-slate-200">
      <summary className="flex min-h-12 cursor-pointer items-center px-4 font-semibold">Something is wrong? Appeal</summary>
      <form action={action} className="space-y-3 px-4 pb-4" aria-label="Appeal">
        <input type="hidden" name="id" value={id} />
        <FormMessage state={state} />
        <label className="block space-y-1.5 text-sm font-semibold">
          What happened
          <textarea name="reason" required minLength={10} maxLength={1000} rows={4} aria-invalid={state.field === "reason" || undefined} className="w-full rounded-xl border border-slate-200 p-3 text-[15px] font-normal" />
        </label>
        <p className="text-xs text-slate-500">Afrippa&apos;s team reads the order room and any proof you sent, then releases the coins to the buyer or returns them to the seller.</p>
        <button type="submit" disabled={pending} className={quiet}>
          Send the appeal
        </button>
      </form>
    </details>
  );
}

const who: Record<OrderMessage["from"], string> = { you: "You", buyer: "Buyer", seller: "Seller", afrippa: "Afrippa", system: "Order" };
const time = (iso: string) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

/**
 * The order room: one chat between the buyer and the seller, with the order's own lines and Afrippa's team. Polled every
 * 4 seconds while the order is open and the tab is shown; read-only once it closes.
 */
export function OrderRoom({ orderId, initial, open: initiallyOpen }: { orderId: string; initial: OrderMessage[]; open: boolean }) {
  const [messages, setMessages] = useState(initial);
  const [open, setOpen] = useState(initiallyOpen);
  const form = useRef<HTMLFormElement>(null);
  const [file, setFile] = useState<string | null>(null);
  const last = messages.at(-1)?.id ?? null;
  // A sent message joins the room at once (the next poll would bring it too, once).
  const [state, action, pending] = useActionState<RoomState, FormData>(async (previous, data) => {
    const answer = await sendToRoom(previous, data);
    const sent = answer.sent;
    if (sent) {
      form.current?.reset();
      setFile(null);
      setMessages(current => (current.some(message => message.id === sent.id) ? current : [...current, sent]));
    }
    return answer;
  }, {});

  useEffect(() => {
    if (!open) return;
    const timer = setInterval(async () => {
      if (document.hidden) return;
      const page = await roomSince(orderId, last);
      if (!page) return;
      setOpen(page.open);
      if (page.data.length) setMessages(current => [...current, ...page.data.filter(message => !current.some(seen => seen.id === message.id))]);
    }, 4000);
    return () => clearInterval(timer);
  }, [orderId, last, open]);

  return (
    <section aria-labelledby="room" className="space-y-3">
      <h2 id="room" className="font-display text-lg font-extrabold">
        Order room
      </h2>
      <ol className="max-h-[28rem] space-y-2 overflow-y-auto rounded-2xl bg-slate-50 p-3" aria-live="polite">
        {messages.map(message =>
          message.from === "system" ? (
            <li key={message.id} className="text-center text-xs text-slate-500">
              {message.body} · {time(message.created_at)}
            </li>
          ) : (
            <li key={message.id} className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm ${message.from === "you" ? "ml-auto bg-navy-900 text-white" : message.from === "afrippa" ? "bg-brand-50 text-navy-900 ring-1 ring-brand-200" : "bg-white ring-1 ring-slate-200"}`}>
              <p className="text-xs font-semibold opacity-75">
                {who[message.from]} · {time(message.created_at)}
              </p>
              {message.file ? (
                <a href={`/orders/${orderId}/files/${message.id}`} target="_blank" rel="noopener" className="mt-1 inline-flex items-center gap-1.5 font-semibold underline">
                  <FileText className="size-4" aria-hidden="true" /> {message.file.name}
                </a>
              ) : null}
              {message.body ? <p className="mt-1 whitespace-pre-wrap break-words">{message.body}</p> : null}
            </li>
          ),
        )}
      </ol>
      {open ? (
        <form ref={form} action={action} className="space-y-2" aria-label="Write in the order room">
          <input type="hidden" name="id" value={orderId} />
          <FormMessage state={state} />
          <label className="sr-only" htmlFor="room-body">
            Message
          </label>
          <textarea id="room-body" name="body" rows={2} maxLength={2000} placeholder="Write to the other trader" className="w-full rounded-xl border border-slate-200 p-3 text-[15px]" />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 text-sm font-semibold text-navy-900">
              <Paperclip className="size-4" aria-hidden="true" />
              <span>{file ?? "Attach proof (photo or PDF)"}</span>
              <input type="file" name="file" accept="image/jpeg,image/png,application/pdf" className="sr-only" onChange={event => setFile(event.currentTarget.files?.[0]?.name ?? null)} />
            </label>
            <button type="submit" disabled={pending} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-brand-500 px-4 font-semibold text-white hover:bg-brand-600 disabled:opacity-60">
              <Send className="size-4" aria-hidden="true" /> Send
            </button>
          </div>
          <p className="text-xs text-slate-500">Never move the trade off Afrippa, and never release coins because someone asks you to here: check your own account.</p>
        </form>
      ) : (
        <p className="text-sm text-slate-500">This order is closed. Its room is kept, read-only.</p>
      )}
    </section>
  );
}
