"use client";

/* eslint-disable @next/next/no-img-element -- chat photos are private: read through this site with the customer's session. */
import { useEffect, useRef, useState } from "react";
import { Camera, EllipsisVertical, LoaderCircle, Send, X } from "lucide-react";
import { reportReasonLabels, shopMoney, type ShopChat, type ShopMessage, type ShopReportReason } from "@bitocard/api-client/classifieds";
import { compressImage } from "@bitocard/ui/image";
import { localPhotoUrl } from "@/lib/shop";
import { answerOffer, blockChat, loadChat, makeOffer, reportChat, sendMessage } from "@/lib/shop-actions";

const pollMs = 4000;
const nonce = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`.replace(/\./g, ""));
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

function merge(messages: ShopMessage[], more: ShopMessage[]) {
  const seen = new Map(messages.map(message => [message.id, message]));
  for (const message of more) seen.set(message.id, message);
  return [...seen.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
}

function hoursLeft(iso: string) {
  const hours = Math.max(0, Math.round((Date.parse(iso) - Date.now()) / 3_600_000));
  return hours < 1 ? "expires soon" : `expires in ${hours} h`;
}

/**
 * A chat about a listing in the Shop tab (the design canvas's Chat board): BitoCard's safety note first, messages and
 * photos, offers with their answers, and a menu to block or report the other person. New messages are fetched every
 * few seconds while the page is open and visible.
 */
export function ChatThread({ initial, buy }: { initial: ShopChat; buy: { handoff: string; path: string } | null }) {
  const [chat, setChat] = useState(initial);
  const [messages, setMessages] = useState(initial.messages);
  const [body, setBody] = useState("");
  const [offer, setOffer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sendingPhoto, setSendingPhoto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [report, setReport] = useState<{ reason: ShopReportReason; details: string; sent: boolean } | null>(null);
  const list = useRef<HTMLOListElement>(null);
  const last = messages.at(-1)?.id;
  const blocked = chat.blocked.by_me || chat.blocked.by_them;
  const currency = chat.listing.price.currency;

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.hidden) return;
      void loadChat(chat.id, last).then(result => {
        if (!result.ok) return;
        setMessages(current => merge(current, result.data.messages));
        setChat(current => ({ ...current, blocked: result.data.blocked, open_offer: result.data.open_offer }));
      });
    }, pollMs);
    return () => clearInterval(timer);
  }, [chat.id, last]);

  useEffect(() => {
    list.current?.lastElementChild?.scrollIntoView({ block: "nearest" });
  }, [messages.length]);

  const refresh = async () => {
    const fresh = await loadChat(chat.id);
    if (fresh.ok) {
      setChat(fresh.data);
      setMessages(fresh.data.messages);
    }
  };

  const send = async () => {
    const text = body.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    const result = await sendMessage(chat.id, text, nonce());
    if (result.ok) {
      setMessages(current => merge(current, [result.data]));
      setBody("");
    } else setError(result.message);
    setBusy(false);
  };

  const sendPhoto = async (file: File | undefined) => {
    if (!file) return;
    setSendingPhoto(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("file", await compressImage(file, undefined, type => type.startsWith("image/")), "photo.jpg");
      if (body.trim()) form.set("body", body.trim());
      const res = await fetch(`/api/shop/chats/${chat.id}/photos`, { method: "POST", body: form });
      const json = (await res.json().catch(() => null)) as (ShopMessage & { error?: { message?: string } }) | null;
      if (!res.ok || !json?.id) setError(json?.error?.message ?? "This photo could not be sent.");
      else {
        setMessages(current => merge(current, [json]));
        setBody("");
      }
    } catch {
      setError("This photo could not be sent. Try again.");
    }
    setSendingPhoto(false);
  };

  const sendOffer = async () => {
    if (!offer?.trim() || busy) return;
    setBusy(true);
    setError(null);
    const result = await makeOffer(chat.id, offer, nonce());
    if (result.ok) {
      setMessages(current => merge(current, [result.data]));
      setOffer(null);
    } else setError(result.message);
    setBusy(false);
  };

  const answer = async (id: string, action: "accept" | "decline" | "withdraw") => {
    setBusy(true);
    setError(null);
    const result = await answerOffer(id, action);
    if (!result.ok) setError(result.message);
    else await refresh();
    setBusy(false);
  };

  const toggleBlock = async () => {
    setMenu(false);
    if (!chat.blocked.by_me && !window.confirm(`Block ${chat.with.name}? Neither of you can write here until you unblock them, and open offers are withdrawn.`)) return;
    const result = await blockChat(chat.id, !chat.blocked.by_me);
    if (!result.ok) setError(result.message);
    else await refresh();
  };

  const sendReport = async () => {
    if (!report) return;
    const result = await reportChat(chat.id, report.reason, report.details);
    if (!result.ok) setError(result.message);
    else setReport({ ...report, sent: true });
  };

  return (
    <section aria-label={`Chat with ${chat.with.name}`} className="grid gap-3">
      <div className="relative flex justify-end">
        <button type="button" aria-label="More: report, block" aria-expanded={menu} onClick={() => setMenu(!menu)} className="grid size-10 place-items-center rounded-full hover:bg-slate-100">
          <EllipsisVertical className="size-5" aria-hidden="true" />
        </button>
        {menu ? (
          <div className="absolute top-11 right-0 z-20 grid w-56 gap-0.5 rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
            <button
              type="button"
              onClick={() => {
                setMenu(false);
                setReport({ reason: "scam", details: "", sent: false });
              }}
              className="flex min-h-10 items-center rounded-lg px-3 text-left text-sm hover:bg-slate-50"
            >
              Report {chat.with.name}
            </button>
            <button type="button" onClick={() => void toggleBlock()} className="flex min-h-10 items-center rounded-lg px-3 text-left text-sm text-brand-700 hover:bg-slate-50">
              {chat.blocked.by_me ? "Unblock" : "Block"} {chat.with.name}
            </button>
          </div>
        ) : null}
      </div>

      {report ? (
        <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <strong>Report {chat.with.name}</strong>
            <button type="button" aria-label="Close" onClick={() => setReport(null)} className="grid size-8 place-items-center rounded-full hover:bg-slate-100">
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
          {report.sent ? (
            <p className="text-sm text-emerald-800">Thanks: BitoCard will read this chat and act on it. You can also block them.</p>
          ) : (
            <>
              <label className="grid gap-1 text-sm font-semibold">
                What is wrong?
                <select value={report.reason} onChange={event => setReport({ ...report, reason: event.target.value as ShopReportReason })} className="h-11 rounded-xl border border-slate-300 bg-white px-3 font-normal">
                  {(Object.keys(reportReasonLabels) as ShopReportReason[]).map(reason => (
                    <option key={reason} value={reason}>
                      {reportReasonLabels[reason]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-sm font-semibold">
                Tell us more <span className="font-normal text-slate-500">(optional)</span>
                <textarea value={report.details} maxLength={1000} rows={3} onChange={event => setReport({ ...report, details: event.target.value })} className="rounded-xl border border-slate-300 px-3 py-2 font-normal" />
              </label>
              <button type="button" onClick={() => void sendReport()} className="h-11 rounded-xl bg-navy-900 font-bold text-white">
                Send report
              </button>
            </>
          )}
        </div>
      ) : null}

      <div className="grid gap-2 rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-200/70">
        <ol ref={list} aria-live="polite" className="grid max-h-[60svh] min-h-64 content-start gap-2 overflow-y-auto pr-1">
          {messages.map(message => (
            <li key={message.id} className={message.from === "me" ? "justify-self-end" : message.from === "bitocard" ? "justify-self-center" : "justify-self-start"}>
              {message.kind === "offer" && message.offer ? (
                <OfferCard message={message} busy={busy} onAnswer={answer} buy={chat.role === "buyer" ? buy : null} withName={chat.with.name} />
              ) : message.from === "bitocard" ? (
                <p className="max-w-md rounded-xl bg-white px-3 py-2 text-center text-xs text-slate-600 ring-1 ring-slate-200/70">{message.body}</p>
              ) : (
                <div className={`grid max-w-[80vw] gap-1 rounded-2xl px-3 py-2 text-sm sm:max-w-sm ${message.from === "me" ? "rounded-br-sm bg-navy-900 text-white" : "rounded-bl-sm bg-white text-navy-900 ring-1 ring-slate-200/70"}`}>
                  {message.kind === "photo" && localPhotoUrl(message.photo?.url) ? (
                    <a href={localPhotoUrl(message.photo?.url)!} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl">
                      <img src={localPhotoUrl(message.photo?.url)!} alt={message.body || "A photo"} className="max-h-64 w-full object-cover" loading="lazy" />
                    </a>
                  ) : null}
                  {message.body ? <span className="whitespace-pre-wrap">{message.body}</span> : null}
                  <span className={`justify-self-end text-[10px] ${message.from === "me" ? "text-white/70" : "text-slate-500"}`}>{time(message.created_at)}</span>
                </div>
              )}
            </li>
          ))}
        </ol>
      </div>

      {blocked ? (
        <p className="rounded-xl bg-slate-100 px-3 py-2.5 text-sm text-slate-700">{chat.blocked.by_me ? `You blocked ${chat.with.name}. Unblock them from the menu to write again.` : "You cannot write in this chat."}</p>
      ) : (
        <>
          {offer !== null ? (
            <form
              className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white p-2"
              onSubmit={event => {
                event.preventDefault();
                void sendOffer();
              }}
            >
              <label className="flex h-11 min-w-0 flex-1 items-center gap-1.5 rounded-xl border border-slate-300 px-3">
                <span className="text-slate-500">{shopMoney(0, currency).replace(/[\d.,\s]/g, "")}</span>
                <input autoFocus value={offer} onChange={event => setOffer(event.target.value)} inputMode="decimal" placeholder="Your offer" aria-label="Your offer" className="min-w-0 flex-1 bg-transparent outline-none" />
              </label>
              <button type="submit" disabled={busy || !offer.trim()} className="h-11 rounded-xl bg-navy-900 px-4 text-sm font-bold text-white disabled:opacity-60">
                Offer
              </button>
              <button type="button" aria-label="Close the offer" onClick={() => setOffer(null)} className="grid size-11 place-items-center rounded-xl hover:bg-slate-100">
                <X className="size-5" aria-hidden="true" />
              </button>
            </form>
          ) : null}
          <form
            className="flex items-end gap-2"
            onSubmit={event => {
              event.preventDefault();
              void send();
            }}
          >
            <label aria-label="Send a photo" className={`grid size-11 shrink-0 cursor-pointer place-items-center rounded-xl border border-slate-300 bg-white hover:border-slate-400 ${sendingPhoto ? "opacity-60" : ""}`}>
              {sendingPhoto ? <LoaderCircle className="size-5 animate-spin" aria-hidden="true" /> : <Camera className="size-5" aria-hidden="true" />}
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                disabled={sendingPhoto}
                onChange={event => {
                  void sendPhoto(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
            </label>
            {offer === null ? (
              <button type="button" onClick={() => setOffer("")} className="h-11 shrink-0 rounded-xl border border-slate-300 bg-white px-3 text-sm font-bold hover:border-slate-400">
                Offer
              </button>
            ) : null}
            <label className="sr-only" htmlFor="chat-message">
              Message
            </label>
            <textarea
              id="chat-message"
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
              placeholder="Write a message"
              className="min-h-11 flex-1 resize-none rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-[15px]"
            />
            <button type="submit" disabled={busy || !body.trim()} aria-label="Send" className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand-700 text-white disabled:opacity-60">
              <Send className="size-5" aria-hidden="true" />
            </button>
          </form>
        </>
      )}
      {error ? (
        <p role="alert" className="text-sm font-semibold text-brand-700">
          {error}
        </p>
      ) : null}
    </section>
  );
}

/**
 * An offer in the chat. An accepted one, to the buyer, leads to Buy with Safe pay at that price on BitoCard Shop
 * (`buy`: the handoff's address and the listing's buy page there).
 */
function OfferCard({ message, busy, onAnswer, buy, withName }: { message: ShopMessage; busy: boolean; onAnswer: (id: string, action: "accept" | "decline" | "withdraw") => void; buy: { handoff: string; path: string } | null; withName: string }) {
  const offer = message.offer!;
  const open = offer.status === "open";
  return (
    <div className="grid w-64 gap-1.5 rounded-2xl border border-slate-200 bg-white p-3 text-navy-900 shadow-sm">
      <span className="text-xs font-semibold text-slate-500">{offer.made_by === "me" ? "Your offer" : `${withName}'s offer`}</span>
      <strong className="text-xl font-extrabold">{shopMoney(offer.price.amount, offer.price.currency)}</strong>
      <span className="text-xs text-slate-600">
        {open
          ? offer.made_by === "me"
            ? `Waiting for ${withName} · ${hoursLeft(offer.expires_at)}`
            : `Open · ${hoursLeft(offer.expires_at)}`
          : offer.status === "accepted"
            ? "Accepted"
            : offer.status === "declined"
              ? "Declined"
              : offer.status === "withdrawn"
                ? "Withdrawn"
                : "Expired"}
      </span>
      {offer.status === "accepted" && buy ? (
        <a href={`${buy.handoff}${encodeURIComponent(`${buy.path}?offer=${offer.id}`)}`} className="mt-1 flex h-10 items-center justify-center rounded-xl bg-emerald-700 text-sm font-bold text-white">
          Buy with Safe pay at this price
        </a>
      ) : null}
      {open ? (
        <div className="mt-1 flex gap-2">
          {offer.made_by === "them" ? (
            <>
              <button type="button" disabled={busy} onClick={() => onAnswer(offer.id, "accept")} className="h-10 flex-1 rounded-xl bg-navy-900 text-sm font-bold text-white disabled:opacity-60">
                Accept
              </button>
              <button type="button" disabled={busy} onClick={() => onAnswer(offer.id, "decline")} className="h-10 flex-1 rounded-xl border border-slate-300 text-sm font-bold disabled:opacity-60">
                Decline
              </button>
            </>
          ) : (
            <button type="button" disabled={busy} onClick={() => onAnswer(offer.id, "withdraw")} className="h-10 w-full rounded-xl border border-slate-300 text-sm font-bold disabled:opacity-60">
              Withdraw offer
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
