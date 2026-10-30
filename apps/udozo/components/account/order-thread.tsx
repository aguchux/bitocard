"use client";

import { useEffect, useRef, useState } from "react";
import type { ShopOrderMessage } from "@bitocard/api-client/classifieds";
import { loadOrderMessages, sendOrderMessage } from "@/lib/shop-actions";
import { loadPurchaseMessages, sendPurchaseMessage } from "@/lib/purchase-actions";

type Thread = "order" | "trade";

/**
 * A resale order's conversation. The supplier reads two threads: the order chat with the buyer (who sees everything
 * from the store's side as the store's) and the trade thread with the reseller. The buyer reads the order chat only.
 * Polled every 5 seconds while the page is visible; links, account numbers and "pay me directly" are refused.
 */
export function OrderThread({ orderId, side, storeName }: { orderId: string; side: "supplier" | "buyer"; storeName: string }) {
  const [thread, setThread] = useState<Thread>("order");
  const [messages, setMessages] = useState<ShopOrderMessage[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLLIElement>(null);

  useEffect(() => {
    let live = true;
    const load = async () => {
      if (document.visibilityState !== "visible") return;
      const result = side === "buyer" ? await loadPurchaseMessages(orderId) : await loadOrderMessages(orderId, thread);
      if (live && result.ok) setMessages(result.data.data);
    };
    void load();
    const timer = window.setInterval(() => void load(), 5000);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [orderId, side, thread]);

  useEffect(() => end.current?.scrollIntoView({ block: "nearest" }), [messages.length]);

  const send = async () => {
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    const result = side === "buyer" ? await sendPurchaseMessage(orderId, text) : await sendOrderMessage(orderId, thread, text);
    if (result.ok) {
      setMessages(current => [...current, result.data]);
      setText("");
    } else setError(result.message);
    setBusy(false);
  };

  const label = (message: ShopOrderMessage) => (message.from === "me" ? "You" : message.name);
  return (
    <section aria-labelledby="order-thread" className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4">
      <h2 id="order-thread" className="font-bold">
        {side === "buyer" ? `Messages with ${storeName}` : "Messages"}
      </h2>
      {side === "supplier" ? (
        <div role="tablist" aria-label="Thread" className="flex gap-1 rounded-xl bg-slate-100 p-1 text-sm font-semibold">
          {(["order", "trade"] as Thread[]).map(item => (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={thread === item}
              onClick={() => {
                setThread(item);
                setMessages([]);
              }}
              className={`h-9 flex-1 rounded-lg ${thread === item ? "bg-white text-navy-900 shadow-sm" : "text-slate-600"}`}
            >
              {item === "order" ? "With the buyer" : `With ${storeName}`}
            </button>
          ))}
        </div>
      ) : null}
      <p className="text-xs text-slate-600">
        {side === "buyer"
          ? "Your order is paid through Udozo. Never pay anyone directly, and never share codes or passwords."
          : thread === "order"
            ? `The buyer sees your messages as from ${storeName}. Keep to this order; never ask for payment outside Udozo.`
            : `Only you and ${storeName} see this thread.`}
      </p>
      <ol className="grid max-h-96 gap-2 overflow-y-auto">
        {messages.map(message => (
          <li key={message.id} className={`grid max-w-md gap-1 rounded-2xl px-3 py-2 text-sm ${message.from === "me" ? "justify-self-end bg-navy-900 text-white" : message.from === "bitocard" ? "justify-self-center bg-amber-50 text-amber-950" : "justify-self-start bg-slate-100"}`}>
            <span className="text-[11px] font-semibold opacity-70">{label(message)}</span>
            <span className="whitespace-pre-wrap">{message.body}</span>
          </li>
        ))}
        <li ref={end} aria-hidden="true" />
      </ol>
      <div className="flex items-end gap-2">
        <textarea value={text} onChange={event => setText(event.target.value)} rows={1} maxLength={2000} placeholder="Write a message" aria-label="Write a message" className="min-h-11 flex-1 resize-none rounded-xl border border-slate-300 px-3 py-2.5 text-[15px]" />
        <button type="button" disabled={busy || !text.trim()} onClick={() => void send()} className="h-11 shrink-0 rounded-xl bg-navy-900 px-4 text-sm font-bold text-white disabled:opacity-60">
          Send
        </button>
      </div>
      {error ? (
        <p role="alert" className="text-sm font-semibold text-brand-700">
          {error}
        </p>
      ) : null}
    </section>
  );
}
