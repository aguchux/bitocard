"use client";

/* eslint-disable @next/next/no-img-element -- listing covers and the assistant's face, from the media CDN. */
import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Check, Copy, Flag as FlagIcon, ImageIcon, Send, Sparkles, ThumbsDown, ThumbsUp, X } from "lucide-react";
import {
  assistantToolLabels,
  parseAssistantEvents,
  shopMoney,
  shopPriceText,
  type ShopAssistantCard,
  type ShopAssistantMessage,
  type ShopAssistantProfile,
  type ShopAssistantThread,
  type ShopListingCard,
} from "@bitocard/api-client/classifieds";
import { assistantIn, rateAnswer, reportAnswer, startConversation, talkToPerson } from "@/lib/assistant-actions";
import { SignInHere } from "./sign-in-here";

type Opening = { listingId?: string; listingTitle?: string; question?: string };
type Assistant = { available: boolean; name: string; open: (opening?: Opening) => void };

const AssistantContext = createContext<Assistant>({ available: false, name: "", open: () => undefined });

/** Whether an assistant answers here, its name, and how to open it (the header, the search bar, a listing page). */
export const useAssistant = () => useContext(AssistantContext);

const languageKey = "udz_assistant_language";
const readLanguage = () => {
  try {
    return localStorage.getItem(languageKey);
  } catch {
    return null;
  }
};
const saveLanguage = (code: string) => {
  try {
    localStorage.setItem(languageKey, code);
  } catch {
    // Remembering the language is a convenience only.
  }
};

/** A listing card's address on this site (the API gives the full https://udozo.com one). */
const localPath = (url: string) => {
  try {
    return new URL(url).pathname;
  } catch {
    return "/";
  }
};

function Face({ profile, size = "size-9" }: { profile: { name: string; avatar_url: string | null }; size?: string }) {
  return profile.avatar_url ? (
    <img src={profile.avatar_url} alt="" className={`${size} shrink-0 rounded-full object-cover`} />
  ) : (
    <span className={`${size} grid shrink-0 place-items-center rounded-full bg-brand-500 text-sm font-bold text-white`} aria-hidden="true">
      {profile.name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function ListingCards({ items }: { items: ShopListingCard[] }) {
  return (
    <ul className="grid gap-2">
      {items.map(item => (
        <li key={item.id}>
          <Link href={localPath(item.url)} className="flex gap-3 rounded-2xl border border-navy-200 bg-white p-2 hover:border-brand-400">
            <span className="relative grid size-16 shrink-0 place-items-center overflow-hidden rounded-xl bg-navy-50">
              {item.cover ? <img src={item.cover.url} alt="" className="size-full object-cover" loading="lazy" /> : <ImageIcon className="size-5 text-navy-400" aria-hidden="true" />}
            </span>
            <span className="grid min-w-0 content-center gap-0.5">
              <strong className="text-sm">{shopPriceText(item.price)}</strong>
              <span className="truncate text-sm">{item.title}</span>
              <span className="truncate text-xs text-navy-500">{[item.area.name, ...item.highlights].join(" · ")}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function DraftCard({ card, listingOnPage }: { card: Extract<ShopAssistantCard, { type: "message_draft" }>; listingOnPage: string | null }) {
  const [copied, setCopied] = useState(false);
  const use = () => {
    if (listingOnPage === card.listing_id) {
      window.dispatchEvent(new CustomEvent("assistant:draft", { detail: { listingId: card.listing_id, text: card.text } }));
      return;
    }
    try {
      sessionStorage.setItem(`assistant:draft:${card.listing_id}`, card.text);
    } catch {
      // Without storage the buyer copies it instead.
    }
    window.location.assign(localPath(card.url));
  };
  return (
    <div className="grid gap-2 rounded-2xl border border-navy-200 bg-white p-3 text-sm">
      <p className="text-xs font-semibold text-navy-500">A first message to the seller of {card.title}. Edit it and send it yourself.</p>
      <p className="whitespace-pre-wrap">{card.text}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={use} className="inline-flex h-9 items-center rounded-xl bg-navy-900 px-3 text-sm font-bold text-white hover:bg-navy-700">
          Use in the chat
        </button>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(card.text).then(() => setCopied(true));
          }}
          className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-navy-200 px-3 text-sm font-semibold hover:bg-navy-50"
        >
          {copied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />} {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

function CardView({ card, signedIn, listingOnPage, onPerson }: { card: ShopAssistantCard; signedIn: boolean; listingOnPage: string | null; onPerson: () => void }) {
  const box = "grid gap-1.5 rounded-2xl border border-navy-200 bg-white p-3 text-sm";
  switch (card.type) {
    case "listings":
    case "compare":
      return <ListingCards items={card.items} />;
    case "safe_pay":
      return (
        <dl className={box}>
          <p className="font-bold">Safe pay</p>
          <div className="flex justify-between">
            <dt className="text-navy-600">Price</dt>
            <dd>{shopMoney(card.price, card.currency)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-navy-600">Safe pay fee</dt>
            <dd>{shopMoney(card.fee, card.currency)}</dd>
          </div>
          <div className="flex justify-between border-t border-navy-100 pt-1.5 font-bold">
            <dt>You pay</dt>
            <dd>{shopMoney(card.total, card.currency)}</dd>
          </div>
          <p className="text-xs text-navy-500">Held by Udozo until you have the item.</p>
        </dl>
      );
    case "price_range":
      return (
        <p className={box}>
          <span className="font-bold">{card.category}: usually {shopMoney(card.low, card.currency)} to {shopMoney(card.high, card.currency)}</span>
          <span className="text-xs text-navy-500">From {card.count} similar listings in the last 90 days. A range, not a valuation.</span>
        </p>
      );
    case "checklist":
      return (
        <div className={box}>
          <p className="font-bold">{card.category ? `Checks for ${card.category}` : "Safe trade checks"}</p>
          <ul className="grid gap-1">
            {card.items.map(item => (
              <li key={item} className="flex gap-2">
                <Check className="mt-0.5 size-4 shrink-0 text-emerald-700" aria-hidden="true" /> {item}
              </li>
            ))}
          </ul>
          <Link href="/safe-trade" className="text-xs font-semibold text-brand-700 hover:underline">
            The Safe Trade Guide
          </Link>
        </div>
      );
    case "message_draft":
      return <DraftCard card={card} listingOnPage={listingOnPage} />;
    case "person":
      return (
        <div className={box}>
          <p>Talk to a person at Udozo about this.</p>
          {signedIn ? (
            <button type="button" onClick={onPerson} className="inline-flex h-9 items-center justify-self-start rounded-xl bg-navy-900 px-3 text-sm font-bold text-white hover:bg-navy-700">
              Talk to a person
            </button>
          ) : (
            <SignInHere className="text-sm font-semibold text-brand-700 hover:underline">Sign in to talk to a person</SignInHere>
          )}
        </div>
      );
    case "orders":
      return (
        <ul className={box}>
          {card.items.map(item => (
            <li key={item.order_id}>
              <strong>{item.number}</strong> {item.listing} · {item.price}
              {item.next ? <span className="block text-xs text-navy-600">{item.next}</span> : null}
            </li>
          ))}
        </ul>
      );
    case "my_listings":
      return (
        <ul className={box}>
          {card.items.map(item => (
            <li key={item.listing_id} className="flex justify-between gap-2">
              <span className="truncate">{item.title}</span>
              <span className="shrink-0 text-xs text-navy-500">{`${item.status} · ${item.views} views`}</span>
            </li>
          ))}
        </ul>
      );
    default:
      return null;
  }
}

function Answer({ message, signedIn, listingOnPage, onPerson }: { message: ShopAssistantMessage; signedIn: boolean; listingOnPage: string | null; onPerson: () => void }) {
  const [rating, setRating] = useState(message.rating);
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState("");
  const [reported, setReported] = useState(message.reported);
  const rate = async (value: "up" | "down") => {
    const result = await rateAnswer(message.id, value);
    if (result.ok) setRating(result.data.rating);
  };
  return (
    <div className="grid gap-2">
      {message.body ? <p className="max-w-[92%] rounded-2xl rounded-tl-md bg-navy-50 px-3.5 py-2.5 text-sm whitespace-pre-wrap">{message.body}</p> : null}
      {message.cards.map((card, index) => (
        <CardView key={index} card={card} signedIn={signedIn} listingOnPage={listingOnPage} onPerson={onPerson} />
      ))}
      <div className="flex items-center gap-1 text-navy-500">
        <button type="button" onClick={() => void rate("up")} aria-label="Helpful" aria-pressed={rating === 1} className={`grid size-8 place-items-center rounded-full hover:bg-navy-50 ${rating === 1 ? "text-emerald-700" : ""}`}>
          <ThumbsUp className="size-4" aria-hidden="true" />
        </button>
        <button type="button" onClick={() => void rate("down")} aria-label="Not helpful" aria-pressed={rating === -1} className={`grid size-8 place-items-center rounded-full hover:bg-navy-50 ${rating === -1 ? "text-brand-700" : ""}`}>
          <ThumbsDown className="size-4" aria-hidden="true" />
        </button>
        {reported ? (
          <span className="text-xs">Reported. Thank you.</span>
        ) : (
          <button type="button" onClick={() => setReporting(open => !open)} className="inline-flex h-8 items-center gap-1 rounded-full px-2 text-xs font-semibold hover:bg-navy-50">
            <FlagIcon className="size-3.5" aria-hidden="true" /> Report this answer
          </button>
        )}
      </div>
      {reporting && !reported ? (
        <form
          className="flex gap-2"
          onSubmit={async event => {
            event.preventDefault();
            const result = await reportAnswer(message.id, reason);
            if (result.ok) {
              setReported(true);
              setReporting(false);
            }
          }}
        >
          <input value={reason} onChange={event => setReason(event.target.value)} placeholder="What was wrong?" maxLength={500} className="h-10 min-w-0 flex-1 rounded-xl border border-navy-200 px-3 text-sm" aria-label="What was wrong with this answer" />
          <button type="submit" disabled={reason.trim().length < 3} className="h-10 rounded-xl bg-navy-900 px-3 text-sm font-bold text-white disabled:opacity-50">
            Send
          </button>
        </form>
      ) : null}
    </div>
  );
}

/**
 * Ask Anjio (or the country's own assistant): a panel from the right on desktops and a sheet from the bottom on phones.
 * The greeting and suggested questions, the language menu where the country's assistants speak several, each answer
 * with the cards its tools returned (listings with their real prices, the Safe pay total, the checks), thumbs, Report,
 * and Talk to a person. Answers stream from this site's route handler; a failure says so and search still works.
 */
function Panel({ country, initial, signedIn, opening, onClose, dialog }: { country: string; initial: ShopAssistantProfile; signedIn: boolean; opening: Opening & { at: number }; onClose: () => void; dialog: React.RefObject<HTMLDialogElement | null> }) {
  const [profile, setProfile] = useState(initial);
  const [thread, setThread] = useState<ShopAssistantThread | null>(null);
  const [messages, setMessages] = useState<Array<{ role: "user"; body: string } | { role: "assistant"; message: ShopAssistantMessage }>>([]);
  const [pending, setPending] = useState<{ tool: string | null; cards: ShopAssistantCard[] } | null>(null);
  const [question, setQuestion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [person, setPerson] = useState<string | null>(null);
  const [listing] = useState<{ id: string; title: string } | null>(opening.listingId ? { id: opening.listingId, title: opening.listingTitle ?? "this listing" } : null);
  const list = useRef<HTMLOListElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const assistant = profile.assistant!;

  useEffect(() => {
    list.current?.lastElementChild?.scrollIntoView({ block: "end" });
  }, [messages, pending]);

  const ask = useCallback(
    async (text: string, about: { id: string; title: string } | null = listing) => {
      const words = text.trim();
      if (!words || pending) return;
      setError(null);
      setQuestion("");
      setMessages(current => [...current, { role: "user", body: words }]);
      setPending({ tool: null, cards: [] });
      let current = thread;
      if (!current || (about?.id ?? null) !== current.listing_id) {
        const started = await startConversation(country, assistant.language, "browse", about?.id);
        if (!started.ok) {
          setPending(null);
          setError(started.message);
          return;
        }
        current = started.data;
        setThread(current);
      }
      try {
        const res = await fetch(`/api/assistant/${current.id}/messages`, { method: "POST", headers: { "content-type": "application/json", accept: "text/event-stream" }, body: JSON.stringify({ body: words }) });
        if (!res.ok || !res.body) {
          const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
          throw new Error(body?.error?.message ?? `${assistant.name} can’t answer right now. Search still works.`);
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let done = false;
        while (!done) {
          const chunk = await reader.read();
          done = chunk.done;
          buffer += decoder.decode(chunk.value ?? new Uint8Array(), { stream: !done });
          const parsed = parseAssistantEvents(done ? `${buffer}\n\n` : buffer);
          buffer = parsed.rest;
          for (const event of parsed.events) {
            if (event.event === "status") setPending(state => ({ tool: event.data.tool, cards: state?.cards ?? [] }));
            else if (event.event === "cards") setPending(state => ({ tool: state?.tool ?? null, cards: [...(state?.cards ?? []), ...event.data.cards] }));
            else if (event.event === "message") setMessages(items => [...items, { role: "assistant", message: event.data }]);
            else if (event.event === "error") setError(event.data.message);
          }
        }
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : `${assistant.name} can’t answer right now. Search still works.`);
      }
      setPending(null);
    },
    [assistant.language, assistant.name, country, listing, pending, thread],
  );

  // The panel is made anew each time it opens (from a listing page it starts about that listing); a question from the
  // search box is asked at once.
  useEffect(() => {
    if (!opening.question) {
      input.current?.focus();
      return;
    }
    const timer = setTimeout(() => void ask(opening.question!, listing), 0);
    return () => clearTimeout(timer);
    // Only when the panel is opened anew.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opening.at]);

  const changeLanguage = async (code: string) => {
    saveLanguage(code);
    const next = await assistantIn(country, code);
    if (next.ok && next.data.assistant) {
      setProfile(next.data);
      setThread(null);
      setMessages([]);
    }
  };

  const handOver = async () => {
    if (!thread) return;
    const result = await talkToPerson(thread.id);
    setPerson(result.ok ? "A person at Udozo will answer in your messages, with this conversation." : result.message);
  };

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      onClick={event => {
        if (event.target === dialog.current) dialog.current?.close();
      }}
      aria-label={`${assistant.name}, AI assistant`}
      className="m-0 mt-auto h-[88dvh] max-h-none w-full max-w-none rounded-t-3xl bg-white p-0 text-navy-900 backdrop:bg-navy-950/50 sm:mt-0 sm:ml-auto sm:h-dvh sm:max-w-md sm:rounded-none"
    >
      <div className="flex h-full flex-col">
        <header className="flex items-center gap-3 border-b border-navy-100 px-4 py-3">
          <Face profile={assistant} />
          <span className="grid min-w-0 flex-1">
            <strong className="truncate">{assistant.name}</strong>
            <span className="text-xs text-navy-500">{assistant.label}</span>
          </span>
          {profile.languages.length > 1 ? (
            <select aria-label="Language" value={assistant.language} onChange={event => void changeLanguage(event.target.value)} className="h-9 rounded-xl border border-navy-200 bg-white px-2 text-sm">
              {profile.languages.map(item => (
                <option key={item.code} value={item.code}>
                  {item.name}
                </option>
              ))}
            </select>
          ) : null}
          <button type="button" onClick={() => dialog.current?.close()} aria-label="Close" className="grid size-9 place-items-center rounded-full hover:bg-navy-50">
            <X className="size-5" aria-hidden="true" />
          </button>
        </header>
        <ol ref={list} className="grid flex-1 content-start gap-3 overflow-y-auto px-4 py-4">
          <li className="grid gap-2">
            {assistant.greeting ? <p className="max-w-[92%] rounded-2xl rounded-tl-md bg-navy-50 px-3.5 py-2.5 text-sm">{assistant.greeting}</p> : null}
            {listing ? <p className="text-xs text-navy-500">Asking about {listing.title}.</p> : null}
            {!messages.length && assistant.suggestions.length ? (
              <div className="flex flex-wrap gap-2">
                {assistant.suggestions.map(item => (
                  <button key={item} type="button" onClick={() => void ask(item)} className="rounded-full border border-navy-200 px-3 py-1.5 text-left text-sm hover:border-brand-400">
                    {item}
                  </button>
                ))}
              </div>
            ) : null}
          </li>
          {messages.map((item, index) =>
            item.role === "user" ? (
              <li key={index} className="ml-auto max-w-[85%] rounded-2xl rounded-tr-md bg-navy-900 px-3.5 py-2.5 text-sm text-white">
                {item.body}
              </li>
            ) : (
              <li key={item.message.id}>
                <Answer message={item.message} signedIn={signedIn} listingOnPage={opening.listingId ?? null} onPerson={() => void handOver()} />
              </li>
            ),
          )}
          {pending ? (
            <li className="grid gap-2" aria-live="polite">
              <p className="text-sm text-navy-500">{pending.tool ? `${assistantToolLabels[pending.tool] ?? "Working"}…` : `${assistant.name} is thinking…`}</p>
              {pending.cards.map((card, index) => (
                <CardView key={index} card={card} signedIn={signedIn} listingOnPage={opening.listingId ?? null} onPerson={() => void handOver()} />
              ))}
            </li>
          ) : null}
          {error ? (
            <li className="rounded-2xl bg-amber-50 p-3 text-sm text-amber-900" role="status">
              {error}{" "}
              <Link href={`/${country.toLowerCase()}/search`} className="font-semibold underline">
                Search instead
              </Link>
            </li>
          ) : null}
          {person ? (
            <li className="rounded-2xl bg-emerald-50 p-3 text-sm text-emerald-900" role="status">
              {person}
            </li>
          ) : null}
        </ol>
        <form
          className="grid gap-2 border-t border-navy-100 p-3"
          onSubmit={event => {
            event.preventDefault();
            void ask(question);
          }}
        >
          <div className="flex items-end gap-2">
            <textarea
              ref={input}
              rows={1}
              value={question}
              onChange={event => setQuestion(event.target.value)}
              onKeyDown={event => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void ask(question);
                }
              }}
              maxLength={1000}
              placeholder="Describe what you want"
              aria-label={`Ask ${assistant.name}`}
              className="max-h-32 min-h-11 flex-1 resize-none rounded-2xl border border-navy-200 px-3.5 py-2.5 text-sm"
            />
            <button type="submit" disabled={!question.trim() || Boolean(pending)} aria-label="Send" className="grid size-11 shrink-0 place-items-center rounded-full bg-brand-700 text-white disabled:opacity-50">
              <Send className="size-5" aria-hidden="true" />
            </button>
          </div>
          <p className="text-center text-[11px] text-navy-500">
            {assistant.name} is Udozo’s AI and can make mistakes. Never share codes or bank details. {thread && signedIn ? (
              <button type="button" onClick={() => void handOver()} className="font-semibold underline">
                Talk to a person
              </button>
            ) : null}
          </p>
        </form>
      </div>
    </dialog>
  );
}

/**
 * The country's assistant for the whole market's pages: renders the panel once and lets the header, the search box and
 * listing pages open it. Without an assistant (switched off, none active) it renders the pages alone.
 */
export function AssistantProvider({ country, profile, signedIn, children }: { country: string; profile: ShopAssistantProfile | null; signedIn: boolean; children: React.ReactNode }) {
  const [opening, setOpening] = useState<(Opening & { at: number }) | null>(null);
  const [current, setCurrent] = useState(profile);
  const dialog = useRef<HTMLDialogElement>(null);

  // A language chosen earlier on this device, where the country's assistants speak it.
  useEffect(() => {
    const saved = readLanguage();
    if (!profile?.assistant || !saved || saved === profile.assistant.language || !profile.languages.some(item => item.code === saved)) return;
    void assistantIn(country, saved).then(result => {
      if (result.ok && result.data.assistant) setCurrent(result.data);
    });
  }, [country, profile]);

  useEffect(() => {
    if (opening && dialog.current && !dialog.current.open) dialog.current.showModal();
  }, [opening]);

  const open = useCallback((next: Opening = {}) => setOpening({ ...next, at: Date.now() }), []);
  const value: Assistant = current?.assistant ? { available: true, name: current.assistant.name, open } : { available: false, name: "", open: () => undefined };
  return (
    <AssistantContext.Provider value={value}>
      {children}
      {current?.assistant && opening ? <Panel country={country} initial={current} signedIn={signedIn} opening={opening} onClose={() => setOpening(null)} dialog={dialog} /> : null}
    </AssistantContext.Provider>
  );
}

/**
 * A first message the assistant drafted for this listing, for its chat: from the panel on this page (an event), or
 * carried over from another page (kept for this tab only). `onOpen` opens the chat to show it.
 */
export function useAssistantDraft(listingId: string, onOpen: () => void) {
  const [draft, setDraft] = useState<{ text: string; at: number } | null>(null);
  const opened = useRef(onOpen);
  useEffect(() => {
    opened.current = onOpen;
  });
  useEffect(() => {
    const apply = (text: string) => {
      opened.current();
      setDraft({ text, at: Date.now() });
    };
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<{ listingId: string; text: string }>).detail;
      if (detail?.listingId === listingId && detail.text) apply(detail.text);
    };
    window.addEventListener("assistant:draft", listener);
    let carried: string | null = null;
    try {
      carried = sessionStorage.getItem(`assistant:draft:${listingId}`);
      sessionStorage.removeItem(`assistant:draft:${listingId}`);
    } catch {
      carried = null;
    }
    const timer = carried ? setTimeout(() => apply(carried!), 0) : null;
    return () => {
      window.removeEventListener("assistant:draft", listener);
      if (timer) clearTimeout(timer);
    };
  }, [listingId]);
  return draft;
}

/** Ask Anjio in the header. */
export function AskButton({ className }: { className?: string }) {
  const assistant = useAssistant();
  if (!assistant.available) return null;
  return (
    <button type="button" onClick={() => assistant.open()} className={`gap-1.5 ${className ?? ""}`}>
      <Sparkles className="size-4 text-brand-500" aria-hidden="true" /> Ask {assistant.name}
    </button>
  );
}

/** Ask Anjio about this listing (its features, the checks, the Safe pay total). */
export function AskAboutListing({ listingId, title }: { listingId: string; title: string }) {
  const assistant = useAssistant();
  if (!assistant.available) return null;
  return (
    <button type="button" onClick={() => assistant.open({ listingId, listingTitle: title })} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl border border-navy-200 bg-white px-4 text-sm font-semibold hover:border-brand-400">
      <Sparkles className="size-4 text-brand-700" aria-hidden="true" /> Ask {assistant.name} about this listing
    </button>
  );
}
