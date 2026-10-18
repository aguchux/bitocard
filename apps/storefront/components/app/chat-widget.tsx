"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useSearchParams } from "next/navigation";
import { Bot, MessageCircle, Send, X } from "lucide-react";
import type { StoreChat, StoreChatMessage } from "@bitocard/api-client/storefront";
import { endChat, loadChat, pollChat, sendChatMessage } from "@/lib/chat-actions";

const time = (iso: string) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

/** Who wrote a chat message, as the customer sees it: never staff names, an assistant by its name. */
export function chatAuthor(message: Pick<StoreChatMessage, "author" | "author_name">, store: string) {
  if (message.author === "bot") return message.author_name ? `${message.author_name} (assistant)` : "Assistant";
  return { customer: "You", reseller: store, bitocard: "BitoCard", system: "" }[message.author];
}

/** Where the chat stands, in the customer's words. */
export function chatStatusLine(status: StoreChat["status"] | null, store: string) {
  if (status === "with_staff") return `You are chatting with ${store}.`;
  if (status === "bot") return "An assistant is answering. Ask for a person any time.";
  if (status === "waiting") return `Waiting for ${store} to reply. We tell you when they do.`;
  return `Ask ${store} anything. Never send codes, PINs or passwords.`;
}

/**
 * The account app's chat with the store: a button that opens a panel (a sheet on phones). It loads the open chat,
 * polls for new messages every 3 seconds while open, and sends with Enter. `?chat=1` opens it on arrival.
 */
export function ChatWidget({ store }: { store: string }) {
  const search = useSearchParams();
  const [open, setOpen] = useState(search.get("chat") === "1");
  const [chat, setChat] = useState<StoreChat | null>(null);
  const [messages, setMessages] = useState<StoreChatMessage[]>([]);
  const [status, setStatus] = useState<StoreChat["status"] | null>(null);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const last = messages.at(-1)?.id ?? null;
  const asked = search.get("chat") === "1";
  // A "Chat now" link (?chat=1) opens it, also when the widget is already on the page (adjusted while rendering).
  const [seenAsked, setSeenAsked] = useState(asked);
  if (asked !== seenAsked) {
    setSeenAsked(asked);
    if (asked) setOpen(true);
  }

  const apply = useCallback((next: StoreChat | null) => {
    setChat(next);
    setMessages(next?.messages ?? []);
    setStatus(next?.status ?? null);
  }, []);

  useEffect(() => {
    if (!open) return;
    let live = true;
    void loadChat().then(result => {
      if (!live) return;
      if (result.ok) apply(result.chat);
      else setError(result.error);
    });
    return () => {
      live = false;
    };
  }, [open, apply]);

  useEffect(() => {
    if (!open || !chat || status === "closed") return;
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      void pollChat(chat.id, last).then(result => {
        if (!result.ok) return;
        setStatus(result.status);
        if (result.messages.length) setMessages(current => [...current, ...result.messages.filter(message => !current.some(seen => seen.id === message.id))]);
      });
    }, 3_000);
    return () => window.clearInterval(timer);
  }, [open, chat, status, last]);

  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "end" });
  }, [last, open]);

  const send = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!body.trim() || busy) return;
    setBusy(true);
    setError(null);
    const result = await sendChatMessage(body);
    setBusy(false);
    if (!result.ok) {
      setError(result.signIn ? "Your session ended: sign in again to chat." : result.error);
      return;
    }
    apply(result.chat);
    setBody("");
  };
  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  };
  const finish = async () => {
    if (!chat) return;
    const result = await endChat(chat.id);
    if (result.ok) apply(null);
    else setError(result.error);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        aria-expanded={open}
        aria-controls="store-chat"
        className="fixed right-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-40 inline-flex size-14 items-center justify-center rounded-full bg-brand-500 text-white shadow-lg hover:bg-brand-600 lg:bottom-6"
      >
        {open ? <X className="size-6" aria-hidden="true" /> : <MessageCircle className="size-6" aria-hidden="true" />}
        <span className="sr-only">{open ? "Close chat" : `Chat with ${store}`}</span>
      </button>
      {open ? (
        <section
          id="store-chat"
          aria-label={`Chat with ${store}`}
          className="fixed inset-x-0 bottom-0 z-40 flex max-h-[80svh] flex-col rounded-t-3xl bg-white shadow-2xl ring-1 ring-slate-200 sm:inset-x-auto sm:right-4 sm:bottom-[calc(9rem+env(safe-area-inset-bottom))] sm:w-96 sm:rounded-3xl lg:bottom-24"
        >
          <header className="flex items-start justify-between gap-3 border-b border-slate-100 p-4">
            <div className="min-w-0">
              <h2 className="font-bold text-navy-900">Chat with {store}</h2>
              <p className="text-xs text-slate-500">{chatStatusLine(status, store)}</p>
            </div>
            <button type="button" onClick={() => setOpen(false)} className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-50" aria-label="Close chat">
              <X className="size-5" aria-hidden="true" />
            </button>
          </header>
          <ol className="min-h-40 flex-1 space-y-2 overflow-y-auto bg-slate-50 p-3" aria-live="polite" aria-label="Messages">
            {messages.map(message =>
              message.author === "system" ? (
                <li key={message.id} className="text-center text-xs text-slate-500">
                  {message.body}
                </li>
              ) : (
                <li key={message.id} className={`flex ${message.author === "customer" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm ${message.author === "customer" ? "bg-navy-900 text-white" : message.author === "bot" ? "bg-violet-50 text-navy-900 ring-1 ring-violet-100" : "bg-white text-navy-900 ring-1 ring-slate-100"}`}>
                    <p className={`mb-0.5 flex items-center gap-1 text-xs ${message.author === "customer" ? "text-white/70" : "text-slate-500"}`}>
                      {message.author === "bot" ? <Bot className="size-3" aria-hidden="true" /> : null}
                      <span className="font-semibold">{chatAuthor(message, store)}</span> · {time(message.created_at)}
                    </p>
                    <p className="whitespace-pre-wrap break-words">{message.body}</p>
                  </div>
                </li>
              ),
            )}
            <div ref={end} />
          </ol>
          {error ? (
            <p role="alert" className="px-4 pt-2 text-sm text-red-700">
              {error}
            </p>
          ) : null}
          <form onSubmit={send} className="flex items-end gap-2 p-3" noValidate>
            <label htmlFor="store-chat-body" className="sr-only">
              Message
            </label>
            <textarea
              id="store-chat-body"
              rows={2}
              maxLength={2000}
              value={body}
              onChange={event => setBody(event.target.value)}
              onKeyDown={onKey}
              placeholder="Write a message"
              className="min-h-11 flex-1 resize-none rounded-xl border border-slate-200 px-3 py-2 text-[15px] text-navy-900 focus:border-navy-900 focus:ring-2 focus:ring-navy-900/15"
            />
            <button type="submit" disabled={busy || !body.trim()} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-brand-500 px-4 font-semibold text-white hover:bg-brand-600 disabled:opacity-60">
              <Send className="size-4" aria-hidden="true" />
              <span className="sr-only sm:not-sr-only">Send</span>
            </button>
          </form>
          {chat && status !== "closed" ? (
            <button type="button" onClick={() => void finish()} className="mx-3 mb-3 min-h-10 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-50">
              End chat
            </button>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
