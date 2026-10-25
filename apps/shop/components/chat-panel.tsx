"use client";

import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { shopMoney, type ShopChat, type ShopMessage } from "@bitocard/api-client/classifieds";
import { answerOffer, loadChat, makeOffer, sendMessage, startChat } from "@/lib/listing-actions";

const quick = ["Is it still available?", "What is your last price?", "Where can we meet?"];
const pollMs = 4000;
const nonce = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`.replace(/\./g, ""));

function merge(messages: ShopMessage[], more: ShopMessage[]) {
  const seen = new Map(messages.map(message => [message.id, message]));
  for (const message of more) seen.set(message.id, message);
  return [...seen.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
}

function OfferCard({ message, onAnswer, busy, buyPath }: { message: ShopMessage; onAnswer: (id: string, action: "accept" | "decline" | "withdraw") => void; busy: boolean; buyPath: string }) {
  const offer = message.offer!;
  const open = offer.status === "open";
  return (
    <div className="grid gap-2 rounded-2xl border border-navy-200 bg-white p-3 text-navy-900">
      <span className="text-xs font-semibold text-navy-500">{offer.made_by === "me" ? "Your offer" : "Their offer"}</span>
      <strong className="text-lg">{shopMoney(offer.price.amount, offer.price.currency)}</strong>
      <span className="text-xs text-navy-600">{open ? "Open for 48 hours" : offer.status === "accepted" ? "Accepted: buy at this price with Safe pay" : offer.status[0]!.toUpperCase() + offer.status.slice(1)}</span>
      {offer.status === "accepted" ? (
        <a href={`${buyPath}?offer=${offer.id}`} className="flex h-10 items-center justify-center rounded-xl bg-mint-700 text-sm font-bold text-white">
          Buy with Safe pay at this price
        </a>
      ) : null}
      {open ? (
        <div className="flex gap-2">
          {offer.made_by === "them" ? (
            <>
              <button type="button" disabled={busy} onClick={() => onAnswer(offer.id, "accept")} className="h-10 flex-1 rounded-xl bg-navy-900 text-sm font-bold text-white disabled:opacity-60">
                Accept
              </button>
              <button type="button" disabled={busy} onClick={() => onAnswer(offer.id, "decline")} className="h-10 flex-1 rounded-xl border border-navy-200 text-sm font-bold disabled:opacity-60">
                Decline
              </button>
            </>
          ) : (
            <button type="button" disabled={busy} onClick={() => onAnswer(offer.id, "withdraw")} className="h-10 rounded-xl border border-navy-200 px-4 text-sm font-bold disabled:opacity-60">
              Withdraw
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The chat with the seller, in place on the listing page: the buyer's first message opens it (quick replies to start),
 * then it polls for new messages while open. Offers are sent and answered here; photos, blocking and reports are in the
 * Shop tab's Messages, where the chat continues.
 */
export function ChatPanel({ listingId, currency, initial, messagesHref, buyPath }: { listingId: string; currency: string; initial: ShopChat | null; messagesHref: string | null; buyPath: string }) {
  const [chat, setChat] = useState<ShopChat | null>(initial);
  const [messages, setMessages] = useState<ShopMessage[]>(initial?.messages ?? []);
  const [body, setBody] = useState(initial ? "" : quick[0]!);
  const [offer, setOffer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const list = useRef<HTMLOListElement>(null);
  const last = messages.at(-1)?.id;

  useEffect(() => {
    if (!chat) return;
    let live = true;
    const timer = setInterval(() => {
      if (document.hidden) return;
      void loadChat(chat.id, last).then(result => {
        if (live && result.ok) setMessages(current => merge(current, result.data.messages));
      });
    }, pollMs);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [chat, last]);

  useEffect(() => {
    list.current?.lastElementChild?.scrollIntoView({ block: "nearest" });
  }, [messages.length]);

  const send = async () => {
    const text = body.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    if (chat) {
      const result = await sendMessage(chat.id, text, nonce());
      if (result.ok) {
        setMessages(current => merge(current, [result.data]));
        setBody("");
      } else setError(result.message);
    } else {
      const result = await startChat(listingId, text, nonce());
      if (result.ok) {
        setChat(result.data);
        setMessages(result.data.messages);
        setBody("");
      } else setError(result.message);
    }
    setBusy(false);
  };

  const sendOffer = async () => {
    if (!chat || busy || !offer.trim()) return;
    setBusy(true);
    setError(null);
    const result = await makeOffer(chat.id, offer, nonce());
    if (result.ok) {
      setMessages(current => merge(current, [result.data]));
      setOffer("");
    } else setError(result.message);
    setBusy(false);
  };

  const onAnswer = async (id: string, action: "accept" | "decline" | "withdraw") => {
    setBusy(true);
    setError(null);
    const result = await answerOffer(id, action);
    if (!result.ok) setError(result.message);
    else if (chat) {
      const fresh = await loadChat(chat.id);
      if (fresh.ok) setMessages(fresh.data.messages);
    }
    setBusy(false);
  };

  const blocked = chat?.blocked.by_me || chat?.blocked.by_them;
  return (
    <section aria-label="Chat with the seller" className="grid gap-3 rounded-2xl border border-navy-200 bg-navy-50 p-3">
      {messages.length ? (
        <ol ref={list} className="grid max-h-96 gap-2 overflow-y-auto pr-1" aria-live="polite">
          {messages.map(message => (
            <li key={message.id} className={message.from === "me" ? "justify-self-end" : message.from === "bitocard" ? "justify-self-center" : "justify-self-start"}>
              {message.kind === "offer" && message.offer ? (
                <OfferCard message={message} onAnswer={onAnswer} busy={busy} buyPath={buyPath} />
              ) : message.from === "bitocard" ? (
                <p className="max-w-md rounded-xl bg-white px-3 py-2 text-center text-xs text-navy-600">{message.body}</p>
              ) : (
                <p className={`max-w-xs rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap sm:max-w-sm ${message.from === "me" ? "rounded-br-sm bg-navy-900 text-white" : "rounded-bl-sm bg-white text-navy-900"}`}>
                  {message.kind === "photo" ? (message.body ? `Photo: ${message.body}` : "Sent a photo") : message.body}
                </p>
              )}
            </li>
          ))}
        </ol>
      ) : (
        <div className="flex flex-wrap gap-2">
          {quick.map(text => (
            <button key={text} type="button" onClick={() => setBody(text)} className="h-9 rounded-full border border-navy-200 bg-white px-3 text-sm font-medium hover:border-navy-500">
              {text}
            </button>
          ))}
        </div>
      )}
      {blocked ? (
        <p className="text-sm text-navy-600">{chat?.blocked.by_me ? "You blocked this chat." : "You cannot write in this chat."}</p>
      ) : (
        <form
          className="flex items-end gap-2"
          onSubmit={event => {
            event.preventDefault();
            void send();
          }}
        >
          <label className="sr-only" htmlFor={`chat-${listingId}`}>
            Message
          </label>
          <textarea
            id={`chat-${listingId}`}
            value={body}
            onChange={event => setBody(event.target.value)}
            rows={2}
            maxLength={2000}
            placeholder="Write to the seller"
            className="min-h-11 flex-1 resize-none rounded-xl border border-navy-200 bg-white px-3 py-2.5 text-[15px] focus:border-navy-500 focus:ring-2 focus:ring-brand-500/30"
          />
          <button type="submit" disabled={busy || !body.trim()} className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand-700 text-white disabled:opacity-60" aria-label="Send">
            <Send className="size-5" aria-hidden="true" />
          </button>
        </form>
      )}
      {chat && !blocked ? (
        <form
          className="flex items-center gap-2"
          onSubmit={event => {
            event.preventDefault();
            void sendOffer();
          }}
        >
          <label className="flex h-11 min-w-0 flex-1 items-center gap-1.5 rounded-xl border border-navy-200 bg-white px-3 text-sm focus-within:ring-2 focus-within:ring-brand-500/30">
            <span className="text-navy-500">{shopMoney(0, currency).replace(/[\d.,\s]/g, "")}</span>
            <input value={offer} onChange={event => setOffer(event.target.value)} inputMode="numeric" placeholder="Make an offer" aria-label="Your offer" className="min-w-0 flex-1 bg-transparent outline-none" />
          </label>
          <button type="submit" disabled={busy || !offer.trim()} className="h-11 rounded-xl border border-navy-900 px-4 text-sm font-bold disabled:opacity-60">
            Offer
          </button>
        </form>
      ) : null}
      {error ? (
        <p className="text-sm font-semibold text-brand-700" role="alert">
          {error}
        </p>
      ) : null}
      {chat && messagesHref ? (
        <a href={messagesHref} className="text-sm font-semibold text-brand-700 hover:underline">
          Continue in My Shop, with photos
        </a>
      ) : null}
    </section>
  );
}
