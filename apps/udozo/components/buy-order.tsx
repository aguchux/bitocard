"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { HandCoins, X } from "lucide-react";
import { buyOrderLabels, shopMoney, type ShopBuyOrder, type ShopBuyOrderAction, type ShopBuyOrderSummary } from "@bitocard/api-client/classifieds";
import { buyOrderStep, createBuyOrder } from "@/lib/buy-order-actions";
import { buyOrderTone, buyQuestion } from "@/lib/buy-orders";
import { fromMinor, toMinor } from "@/lib/shop";
import { useConfirm } from "./confirm-dialog";

const nonce = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`.replace(/\./g, ""));

/** A buy order's status as a small coloured label, in the reader's words. */
export function BuyOrderStatus({ order }: { order: Pick<ShopBuyOrderSummary, "status" | "role"> }) {
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${buyOrderTone(order.status)}`}>{buyOrderLabels[order.role][order.status]}</span>;
}

/**
 * The buy form, in a sheet (from the bottom on phones): the price (the asking price to start), how many, a note and
 * where they would like to meet. Payment is between buyer and seller when they meet.
 */
export function BuyOrderSheet({
  dialog,
  listing,
  onSent,
}: {
  dialog: React.RefObject<HTMLDialogElement | null>;
  listing: { id: string; title: string; currency: string; price: number | null; available: number };
  onSent: (order: ShopBuyOrder) => void;
}) {
  const [quantity, setQuantity] = useState(1);
  const [price, setPrice] = useState(fromMinor(listing.price));
  const [note, setNote] = useState("");
  const [meet, setMeet] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState(nonce);
  const most = Math.max(1, Math.min(listing.available, 100));
  const changeQuantity = (next: number) => {
    setQuantity(next);
    if (listing.price !== null) setPrice(fromMinor(listing.price * next));
  };
  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    const minor = toMinor(price);
    if (minor === null) return setError("Give your price as an amount, such as 250,000.");
    setBusy(true);
    setError(null);
    const result = await createBuyOrder(listing.id, { price: minor, quantity, note, meet_note: meet }, key);
    setBusy(false);
    if (!result.ok) {
      setKey(nonce());
      return setError(result.message);
    }
    dialog.current?.close();
    onSent(result.data);
  };
  return (
    <dialog ref={dialog} aria-label="Buy this" className="sheet m-0 mt-auto w-full max-w-none rounded-t-3xl bg-white p-0 text-navy-900 sm:m-auto sm:max-w-md sm:rounded-3xl" onClick={event => event.target === event.currentTarget && event.currentTarget.close()}>
      <form onSubmit={event => void send(event)} className="grid gap-4 p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">Buy this</h2>
          <button type="button" onClick={() => dialog.current?.close()} className="grid size-10 place-items-center rounded-full hover:bg-navy-50" aria-label="Close">
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>
        <p className="text-sm text-navy-700">
          Ask the seller to sell you <span className="font-semibold">{listing.title}</span>. Once they accept, it is held for you while you meet. Inspect it, then pay them in person.
        </p>
        {most > 1 ? (
          <label className="grid gap-1.5 text-sm font-semibold">
            How many
            <select value={quantity} onChange={event => changeQuantity(Number(event.target.value))} className="h-12 rounded-xl border border-navy-200 bg-white px-3 font-normal">
              {Array.from({ length: most }, (_, index) => index + 1).map(count => (
                <option key={count} value={count}>
                  {count}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="grid gap-1.5 text-sm font-semibold">
          Your price{quantity > 1 ? ` for all ${quantity}` : ""} ({listing.currency})
          <input value={price} onChange={event => setPrice(event.target.value)} inputMode="decimal" required placeholder="250,000" className="h-12 rounded-xl border border-navy-200 px-3 font-normal focus:border-navy-500" />
          {listing.price !== null ? <span className="text-xs font-normal text-navy-600">Asking {shopMoney(listing.price * quantity, listing.currency)}. You can offer less: the seller may accept or offer another price.</span> : null}
        </label>
        <label className="grid gap-1.5 text-sm font-semibold">
          Where and when you would like to meet (optional)
          <input value={meet} onChange={event => setMeet(event.target.value)} maxLength={300} placeholder="A busy public place, a day and time" className="h-12 rounded-xl border border-navy-200 px-3 font-normal focus:border-navy-500" />
        </label>
        <label className="grid gap-1.5 text-sm font-semibold">
          A note for the seller (optional)
          <textarea value={note} onChange={event => setNote(event.target.value)} rows={2} maxLength={300} className="rounded-xl border border-navy-200 px-3 py-2 font-normal focus:border-navy-500" />
        </label>
        <p className="text-xs text-navy-600">Never pay before you have seen the item. Udozo does not hold the money for buy orders.</p>
        {error ? (
          <p className="text-sm text-brand-700" role="alert">
            {error}
          </p>
        ) : null}
        <button type="submit" disabled={busy} className="h-12 rounded-2xl bg-navy-900 font-bold text-white disabled:opacity-60">
          {busy ? "Sending…" : "Send buy order"}
        </button>
      </form>
    </dialog>
  );
}

/** A buy order's step in a chat: what happened, and the order as it stands now, opening it. */
export function BuyOrderCard({ body, order, mine }: { body: string; order: ShopBuyOrderSummary; mine: boolean }) {
  return (
    <div className={`grid w-64 max-w-[80vw] gap-1.5 rounded-2xl border bg-white p-3 text-sm text-navy-900 ${mine ? "border-navy-300" : "border-slate-200"}`}>
      <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
        <HandCoins className="size-4" aria-hidden="true" /> Buy order {order.number}
      </span>
      <span>{body}</span>
      <span className="flex flex-wrap items-center gap-1.5">
        <strong>{shopMoney(order.counter ?? order.price, order.currency)}</strong>
        <BuyOrderStatus order={order} />
      </span>
      <Link href={`/account/buy-orders/${order.id}`} className={`mt-1 flex h-10 items-center justify-center rounded-xl text-sm font-bold ${order.actions.length ? "bg-navy-900 text-white" : "border border-slate-300"}`}>
        {order.actions.length ? "Open and answer" : "Open the buy order"}
      </Link>
    </div>
  );
}

const buttonWords: Record<ShopBuyOrderAction, string> = {
  accept: "Accept",
  counter: "Offer another price",
  decline: "Decline",
  accept_counter: "Accept their price",
  cancel: "Cancel the buy order",
  no_show: "It did not happen",
  complete: "Mark sold",
  bought: "I bought it",
  void: "I did not buy this",
  confirm: "Yes, I bought it",
  extend: "Give more time",
};
const primary: ShopBuyOrderAction[] = ["accept", "accept_counter", "complete", "bought", "confirm"];

/** The steps the reader can take on a buy order, each confirmed first in Udozo's own dialog. */
export function BuyOrderControls({ order }: { order: ShopBuyOrder }) {
  const router = useRouter();
  const [confirm, dialog] = useConfirm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [counter, setCounter] = useState<string | null>(null);
  const take = async (action: ShopBuyOrderAction, input: { price?: number } = {}) => {
    const answer = await confirm(buyQuestion(action, order, input.price));
    if (!answer) return;
    setBusy(true);
    setError(null);
    const result = await buyOrderStep(order.id, action, { ...input, reason: answer.reason });
    setBusy(false);
    if (!result.ok) return setError(result.message);
    setCounter(null);
    router.refresh();
  };
  const sendCounter = (event: React.FormEvent) => {
    event.preventDefault();
    const minor = toMinor(counter ?? "");
    if (minor === null) return setError("Give your price as an amount, such as 250,000.");
    void take("counter", { price: minor });
  };
  if (!order.actions.length) return null;
  return (
    <div className="grid gap-2.5">
      {dialog}
      {counter !== null ? (
        <form onSubmit={sendCounter} className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white p-2">
          <span className="pl-2 text-sm font-semibold text-slate-500">{order.currency}</span>
          <input autoFocus value={counter} onChange={event => setCounter(event.target.value)} inputMode="decimal" aria-label="Your price" placeholder="Your price" className="min-w-0 flex-1 bg-transparent outline-none" />
          <button type="submit" disabled={busy} className="h-11 rounded-xl bg-navy-900 px-4 text-sm font-bold text-white disabled:opacity-60">
            Send
          </button>
          <button type="button" aria-label="Close" onClick={() => setCounter(null)} className="grid size-11 place-items-center rounded-xl hover:bg-slate-100">
            <X className="size-4" aria-hidden="true" />
          </button>
        </form>
      ) : null}
      <div className="grid gap-2 sm:grid-cols-2">
        {order.actions.map(action => (
          <button
            key={action}
            type="button"
            disabled={busy}
            onClick={() => (action === "counter" ? setCounter(fromMinor(order.price)) : void take(action))}
            className={`min-h-12 rounded-2xl px-4 text-sm font-bold disabled:opacity-60 ${primary.includes(action) ? "bg-navy-900 text-white hover:bg-navy-700" : action === "void" || action === "decline" ? "border border-red-300 text-red-800 hover:bg-red-50" : "border border-slate-300 hover:bg-slate-50"}`}
          >
            {buttonWords[action]}
          </button>
        ))}
      </div>
      {error ? (
        <p className="text-sm text-brand-700" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
