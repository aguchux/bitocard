"use client";

import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { resaleDealText, type ShopReseller, type ShopResaleDeal, type ShopResaleMessage } from "@bitocard/api-client/classifieds";
import { decideResaleNote, endResaleDeal, loadResaleMessages, offerResaleDeal, sendResaleMessage, setResellerStopped } from "@/lib/shop-actions";

const pollMs = 4000;
const nonce = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`.replace(/\./g, ""));
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const field = "h-11 rounded-xl border border-slate-300 bg-white px-3 font-normal";
const primary = "h-11 rounded-xl bg-navy-900 px-4 text-sm font-bold text-white disabled:opacity-60";
const secondary = "h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold text-navy-900 hover:border-slate-400 disabled:opacity-60";

function merge(messages: ShopResaleMessage[], more: ShopResaleMessage[]) {
  const seen = new Map(messages.map(message => [message.id, message]));
  for (const message of more) seen.set(message.id, message);
  return [...seen.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
}

/** The chat with a reseller: messages and deal updates, fetched every few seconds while the page is open and visible. */
export function ResellerChat({ relationshipId, initial, closed: closedAtFirst, resellerName }: { relationshipId: string; initial: ShopResaleMessage[]; closed: boolean; resellerName: string }) {
  const [messages, setMessages] = useState(initial);
  const [closed, setClosed] = useState(closedAtFirst);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const list = useRef<HTMLOListElement>(null);
  const last = messages.at(-1)?.id;

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.hidden) return;
      void loadResaleMessages(relationshipId, last).then(result => {
        if (!result.ok) return;
        setMessages(current => merge(current, result.data.data));
        setClosed(result.data.closed);
      });
    }, pollMs);
    return () => clearInterval(timer);
  }, [relationshipId, last]);

  useEffect(() => {
    list.current?.lastElementChild?.scrollIntoView({ block: "nearest" });
  }, [messages.length]);

  const send = async () => {
    const text = body.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    const result = await sendResaleMessage(relationshipId, text, nonce());
    if (result.ok) {
      setMessages(current => merge(current, [result.data]));
      setBody("");
    } else setError(result.message);
    setBusy(false);
  };

  return (
    <div className="grid gap-2">
      <div className="rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-200/70">
        <ol ref={list} aria-live="polite" aria-label={`Chat with ${resellerName}`} className="grid max-h-[50svh] min-h-48 content-start gap-2 overflow-y-auto pr-1">
          {messages.length ? null : <li className="justify-self-center py-6 text-sm text-slate-500">No messages yet.</li>}
          {messages.map(message => (
            <li key={message.id} className={message.author === "system" ? "justify-self-center" : message.mine ? "justify-self-end" : "justify-self-start"}>
              {message.author === "system" ? (
                <p className="max-w-md rounded-xl bg-white px-3 py-2 text-center text-xs text-slate-600 ring-1 ring-slate-200/70">{message.body}</p>
              ) : (
                <div className={`grid max-w-[80vw] gap-1 rounded-2xl px-3 py-2 text-sm sm:max-w-sm ${message.mine ? "rounded-br-sm bg-navy-900 text-white" : "rounded-bl-sm bg-white text-navy-900 ring-1 ring-slate-200/70"}`}>
                  {message.mine ? null : <span className="text-xs font-semibold text-slate-500">{message.author_name}</span>}
                  <span className="whitespace-pre-wrap">{message.body}</span>
                  <span className={`justify-self-end text-[10px] ${message.mine ? "text-white/70" : "text-slate-500"}`}>{time(message.created_at)}</span>
                </div>
              )}
            </li>
          ))}
        </ol>
      </div>
      {closed ? (
        <p className="rounded-xl bg-slate-100 px-3 py-2.5 text-sm text-slate-700">This chat is closed.</p>
      ) : (
        <form
          className="flex items-end gap-2"
          onSubmit={event => {
            event.preventDefault();
            void send();
          }}
        >
          <textarea
            value={body}
            onChange={event => setBody(event.target.value)}
            onKeyDown={event => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
            rows={1}
            maxLength={2000}
            placeholder={`Write to ${resellerName}`}
            aria-label={`Write to ${resellerName}`}
            className="min-h-11 min-w-0 flex-1 resize-none rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm"
          />
          <button type="submit" disabled={busy || !body.trim()} aria-label="Send" className="grid size-11 shrink-0 place-items-center rounded-xl bg-navy-900 text-white disabled:opacity-60">
            <Send className="size-5" aria-hidden="true" />
          </button>
        </form>
      )}
      {error ? <p className="text-sm text-brand-700">{error}</p> : null}
    </div>
  );
}

/** Running and offered deals, each with Withdraw or End, and the form to offer a new one. */
export function ResellerDeals({ reseller }: { reseller: ShopReseller }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ listingId: "", discount: "", floor: "", endsOn: "" });
  const [open, setOpen] = useState(false);
  const listings = [...new Map((reseller.listings ?? []).map(item => [item.listing.id, item.listing])).values()];

  const end = async (deal: ShopResaleDeal) => {
    setBusy(deal.id);
    setError(null);
    const result = await endResaleDeal(reseller.id, deal.id);
    if (!result.ok) setError(result.message);
    setBusy(null);
  };
  const offer = async () => {
    setBusy("offer");
    setError(null);
    const result = await offerResaleDeal(reseller.id, { listingId: form.listingId || null, discount: form.discount, floor: form.floor, endsOn: form.endsOn }, nonce());
    if (result.ok) {
      setOpen(false);
      setForm({ listingId: "", discount: "", floor: "", endsOn: "" });
    } else setError(result.message);
    setBusy(null);
  };

  return (
    <div className="grid gap-3">
      {reseller.deals.length ? (
        <ul className="grid gap-2">
          {reseller.deals.map(deal => (
            <li key={deal.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3">
              <div className="grid min-w-0 gap-0.5">
                <span className={`w-fit rounded-full px-2 py-0.5 text-[11px] font-bold ${deal.status === "active" ? "bg-emerald-50 text-emerald-800" : "bg-pink-50 text-brand-700"}`}>{deal.status === "active" ? "Running" : "Waiting for their answer"}</span>
                <span className="text-sm">{resaleDealText(deal)}</span>
              </div>
              <button type="button" className={secondary} disabled={busy === deal.id || reseller.stopped} onClick={() => void end(deal)}>
                {deal.status === "active" ? "End deal" : "Withdraw"}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-600">No deals. They earn your listings’ own discount and never sell below your price.</p>
      )}
      {reseller.stopped || reseller.closed_by_reseller ? null : open ? (
        <form
          className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4"
          onSubmit={event => {
            event.preventDefault();
            void offer();
          }}
        >
          <label className="grid gap-1 text-sm font-semibold">
            On
            <select value={form.listingId} onChange={event => setForm({ ...form, listingId: event.target.value })} className={field}>
              <option value="">Every listing of yours they sell</option>
              {listings.map(listing => (
                <option key={listing.id} value={listing.id}>{listing.title}</option>
              ))}
            </select>
          </label>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="grid gap-1 text-sm font-semibold">
              Their discount (%)
              <input value={form.discount} onChange={event => setForm({ ...form, discount: event.target.value })} inputMode="decimal" className={field} required />
            </label>
            <label className="grid gap-1 text-sm font-semibold">
              May sell below your price by (%)
              <input value={form.floor} onChange={event => setForm({ ...form, floor: event.target.value })} inputMode="decimal" placeholder="0" className={field} />
            </label>
            <label className="grid gap-1 text-sm font-semibold">
              Until <span className="font-normal text-slate-500">(optional)</span>
              <input type="date" value={form.endsOn} onChange={event => setForm({ ...form, endsOn: event.target.value })} className={field} />
            </label>
          </div>
          <p className="text-xs text-slate-500">They accept it in their chat with you. It applies to new orders only; either of you can end it.</p>
          <div className="flex flex-wrap gap-2">
            <button type="submit" className={primary} disabled={busy === "offer" || !form.discount.trim()}>Offer deal</button>
            <button type="button" className={secondary} onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </form>
      ) : (
        <button type="button" className={`${secondary} w-fit`} onClick={() => setOpen(true)}>Offer a deal</button>
      )}
      {error ? <p className="text-sm text-brand-700">{error}</p> : null}
    </div>
  );
}

/** A reseller's note waiting for (or after) the supplier's decision: Approve exactly this text, Refuse with a reason, Withdraw. */
export function NoteDecision({ relationshipId, item }: { relationshipId: string; item: NonNullable<ShopReseller["listings"]>[number] }) {
  const [reason, setReason] = useState("");
  const [refusing, setRefusing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const note = item.note!;
  const decide = async (decision: "approve" | "refuse" | "withdraw") => {
    setBusy(true);
    setError(null);
    const result = await decideResaleNote(relationshipId, item.id, decision, { note: note.text, reason });
    if (!result.ok) setError(result.message);
    setBusy(false);
    setRefusing(false);
  };
  return (
    <div className="grid gap-2 rounded-xl border border-slate-200 bg-white p-3">
      <p className="text-xs text-slate-500">On “{item.listing.title}”</p>
      <blockquote className="rounded-lg bg-slate-50 px-3 py-2 text-sm">“{note.text}”</blockquote>
      {note.status === "pending" ? (
        refusing ? (
          <div className="grid gap-2">
            <input value={reason} maxLength={300} onChange={event => setReason(event.target.value)} placeholder="Why (they will see this)" aria-label="Why you refuse it" className={field} />
            <div className="flex flex-wrap gap-2">
              <button type="button" className={primary} disabled={busy} onClick={() => void decide("refuse")}>Refuse</button>
              <button type="button" className={secondary} onClick={() => setRefusing(false)}>Back</button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <button type="button" className={primary} disabled={busy} onClick={() => void decide("approve")}>Approve</button>
            <button type="button" className={secondary} disabled={busy} onClick={() => setRefusing(true)}>Refuse</button>
          </div>
        )
      ) : note.status === "approved" ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-800">Approved: shown on their store</span>
          <button type="button" className={secondary} disabled={busy} onClick={() => void decide("withdraw")}>Withdraw approval</button>
        </div>
      ) : (
        <span className="w-fit rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-700">{note.status === "refused" ? "You refused it" : "Approval withdrawn"}</span>
      )}
      {error ? <p className="text-sm text-brand-700">{error}</p> : null}
    </div>
  );
}

/** Stop this reseller selling your listings on every store of theirs, after a confirmation; or let them again. */
export function StopReselling({ reseller }: { reseller: ShopReseller }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toggle = async (stopped: boolean) => {
    setBusy(true);
    setError(null);
    const result = await setResellerStopped(reseller.id, stopped);
    if (!result.ok) setError(result.message);
    setBusy(false);
    setConfirming(false);
  };
  return (
    <div className="grid gap-2">
      {reseller.stopped ? (
        <button type="button" className={`${secondary} w-fit`} disabled={busy} onClick={() => void toggle(false)}>Let them resell again</button>
      ) : confirming ? (
        <div className="grid gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
          <p>Your listings come off every store of {reseller.reseller.name} at once, your deals with them end and the chat closes.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={primary} disabled={busy} onClick={() => void toggle(true)}>Stop them</button>
            <button type="button" className={secondary} onClick={() => setConfirming(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <button type="button" className={`${secondary} w-fit text-brand-700`} onClick={() => setConfirming(true)}>Stop them reselling my listings</button>
      )}
      {error ? <p className="text-sm text-brand-700">{error}</p> : null}
    </div>
  );
}
