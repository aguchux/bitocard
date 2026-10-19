"use client";

import { useCallback, useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from "react";
import { useSearchParams } from "next/navigation";
import { Bot, FileText, Loader2, MessageCircle, Paperclip, SendHorizontal, UserRound, X } from "lucide-react";
import type { StoreAssistant, StoreChat, StoreChatAttachment, StoreChatMessage, StoreChatVisitor } from "@bitocard/api-client/storefront";
import { chatFileAccept, formatFileSize, initials, prepareChatFile, startsRun } from "@bitocard/ui/chat";
import { appUrl } from "@bitocard/ui/site";
import { askForPerson, endChat, loadChat, pollChat, sendChatMessage, startChat } from "@/lib/chat-actions";

type Identity = "customer" | "visitor";
const time = (iso: string) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

/** Who wrote a chat message, as the customer sees it: the person who answered by name, an assistant by its name. */
export function chatAuthor(message: Pick<StoreChatMessage, "author" | "author_name">, store: string) {
  if (message.author === "bot") return message.author_name ? `${message.author_name} (assistant)` : "Assistant";
  if (message.author === "customer") return "You";
  if (message.author === "reseller") return message.author_name ?? store;
  if (message.author === "bitocard") return message.author_name ?? "BitoCard";
  return "";
}

/** Where the chat stands, in the customer's words. */
export function chatStatusLine(status: StoreChat["status"] | null, store: string, person?: string | null) {
  if (status === "with_staff") return person ? `${person} from ${store} is chatting with you.` : `You are chatting with ${store}.`;
  if (status === "bot") return "An assistant is answering. Ask for a person any time.";
  if (status === "waiting") return `Waiting for ${store} to reply. We tell you when they do.`;
  return `Ask ${store} anything. Never send codes, PINs or passwords.`;
}

/** The person answering now: the latest message from the store's side, by name. */
export function answeringPerson(messages: Pick<StoreChatMessage, "author" | "author_name">[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if ((message.author === "reseller" || message.author === "bitocard") && message.author_name) return message.author_name;
  }
  return null;
}

function Avatar({ name, author, src, size = "size-8" }: { name: string | null; author: StoreChatMessage["author"] | "store"; src?: string | null; size?: string }) {
  const base = `grid ${size} shrink-0 place-items-center overflow-hidden rounded-full text-[11px] font-bold`;
  if (author === "bot") {
    return src ? (
      // eslint-disable-next-line @next/next/no-img-element -- the assistant's uploaded face on the storage CDN
      <img src={src} alt="" className={`${base} object-cover ring-1 ring-violet-100`} />
    ) : (
      <span className={`${base} bg-violet-100 text-violet-700`} aria-hidden="true">
        <Bot className="size-4" />
      </span>
    );
  }
  const tone = author === "customer" ? "bg-navy-900 text-white" : "bg-brand-500 text-white";
  return (
    <span className={`${base} ${tone}`} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

function Attachment({ chatId, file, as, ours }: { chatId: string; file: StoreChatAttachment; as: Identity; ours: boolean }) {
  const href = `/api/chat/files/${chatId}/${file.id}?as=${as}`;
  if (file.content_type.startsWith("image/")) {
    return (
      <a href={href} target="_blank" rel="noopener" className="block overflow-hidden rounded-2xl bg-slate-100" aria-label={`Open ${file.name}`}>
        {/* eslint-disable-next-line @next/next/no-img-element -- a chat photo read through this store's own server */}
        <img src={href} alt={file.name} loading="lazy" className="max-h-56 w-full max-w-60 object-cover" />
      </a>
    );
  }
  return (
    <a href={href} target="_blank" rel="noopener" className={`flex w-full max-w-60 items-center gap-2 rounded-2xl px-3 py-2 ${ours ? "bg-navy-800 text-white" : "bg-white text-navy-900 ring-1 ring-slate-200"}`}>
      <FileText className="size-5 shrink-0" aria-hidden="true" />
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold">{file.name}</span>
        <span className={`block text-xs ${ours ? "text-white/70" : "text-slate-500"}`}>PDF · {formatFileSize(file.size)}</span>
      </span>
    </a>
  );
}

/** A signed-out visitor introduces themselves: name, email and their first message. */
function Introduce({ store, onStarted }: { store: string; onStarted: (chat: StoreChat, visitor: StoreChatVisitor | undefined) => void }) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    const result = await startChat({ name: String(data.get("name") ?? ""), email: String(data.get("email") ?? ""), body: String(data.get("body") ?? "") });
    setBusy(false);
    if (result.ok && result.chat) onStarted(result.chat, result.visitor);
    else if (!result.ok) setError(result.error);
  };
  const field = "mt-1 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-[15px] text-navy-900 focus:border-navy-900 focus:ring-2 focus:ring-navy-900/15";
  return (
    <form onSubmit={submit} className="space-y-3 p-4" noValidate>
      <div className="rounded-2xl bg-white p-4 text-sm text-slate-600 ring-1 ring-slate-100">
        <p className="font-semibold text-navy-900">Hi there 👋</p>
        <p className="mt-1">Tell us who you are and what you need. {store} replies here, and by email if you leave.</p>
      </div>
      <label htmlFor={`${id}-name`} className="block text-sm font-semibold text-navy-900">
        Your name
        <input id={`${id}-name`} name="name" required maxLength={80} autoComplete="name" className={field} />
      </label>
      <label htmlFor={`${id}-email`} className="block text-sm font-semibold text-navy-900">
        Email
        <input id={`${id}-email`} name="email" type="email" required maxLength={254} autoComplete="email" className={field} />
      </label>
      <label htmlFor={`${id}-body`} className="block text-sm font-semibold text-navy-900">
        How can we help?
        <textarea id={`${id}-body`} name="body" required rows={3} maxLength={2000} className={`${field} resize-none`} />
      </label>
      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
      <button type="submit" disabled={busy} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-brand-500 font-semibold text-white hover:bg-brand-600 disabled:opacity-60">
        {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null} Start chat
      </button>
      <p className="text-center text-xs text-slate-500">
        We use your name and email only to answer you. See the{" "}
        <a href={appUrl("legals", "/documents/privacy")} className="underline" target="_blank" rel="noopener">
          privacy notice
        </a>
        .
      </p>
    </form>
  );
}

/**
 * Chat with the store, on every store and account page: a button that opens a full-height panel flying in from the
 * left (a sheet pulled up from the bottom on phones). Signed-in customers chat as themselves; visitors give their name
 * and email first. It loads the open chat, polls for new messages every 3 seconds while open, sends with Enter, and
 * takes photos and PDFs. `?chat=1` opens it on arrival. `aboveNav` lifts the button over the account app's bottom bar.
 */
export function ChatWidget({ store, aboveNav = false }: { store: string; aboveNav?: boolean }) {
  const search = useSearchParams();
  const [open, setOpen] = useState(search.get("chat") === "1");
  const [loaded, setLoaded] = useState(false);
  const [chat, setChat] = useState<StoreChat | null>(null);
  const [messages, setMessages] = useState<StoreChatMessage[]>([]);
  const [status, setStatus] = useState<StoreChat["status"] | null>(null);
  const [assistant, setAssistant] = useState<StoreAssistant | null>(null);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [visitor, setVisitor] = useState<StoreChatVisitor | null>(null);
  const [body, setBody] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
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
      setLoaded(true);
      if (result.ok) {
        apply(result.chat);
        setAssistant(result.assistant);
        setIdentity(result.identity);
        setVisitor(result.visitor);
      } else setError(result.error);
    });
    return () => {
      live = false;
    };
  }, [open, apply]);

  useEffect(() => {
    if (!open || !chat || !identity || status === "closed") return;
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      void pollChat(chat.id, last, identity).then(result => {
        if (!result.ok) return;
        setStatus(result.status);
        if (result.messages.length) setMessages(current => [...current, ...result.messages.filter(message => !current.some(seen => seen.id === message.id))]);
      });
    }, 3_000);
    return () => window.clearInterval(timer);
  }, [open, chat, status, last, identity]);

  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "end" });
  }, [last, open]);

  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [body]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const send = async (event?: FormEvent) => {
    event?.preventDefault();
    if (busy || !identity) return;
    if (!file && !body.trim()) return;
    setBusy(true);
    setError(null);
    if (file) {
      const form = new FormData();
      form.set("file", file, file.name);
      form.set("as", identity);
      if (body.trim()) form.set("body", body.trim());
      const res = await fetch("/api/chat/attachments", { method: "POST", body: form }).catch(() => null);
      const json = (await res?.json().catch(() => null)) as (StoreChat & { error?: { message?: string } }) | null;
      setBusy(false);
      if (!res?.ok || !json) {
        setError(json?.error?.message ?? "The file could not be sent. Try again.");
        return;
      }
      apply(json);
      setFile(null);
      setBody("");
      return;
    }
    const result = await sendChatMessage(body, identity);
    setBusy(false);
    if (!result.ok) {
      if (result.introduce) setIdentity(null);
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
  const choose = async (event: ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0];
    event.target.value = "";
    if (!picked) return;
    const ready = await prepareChatFile(picked);
    if ("problem" in ready) setError(ready.problem);
    else {
      setError(null);
      setFile(ready.file);
    }
  };
  const person = async () => {
    if (!chat || !identity) return;
    const result = await askForPerson(chat.id, identity);
    if (result.ok) apply(result.chat);
    else setError(result.error);
  };
  const finish = async () => {
    if (!chat || !identity) return;
    const result = await endChat(chat.id, identity);
    if (result.ok) apply(null);
    else setError(result.error);
  };

  const withAssistant = Boolean(assistant) && (status === null || status === "bot");
  // The assistant's face as it last answered, else as the store set it now.
  const assistantFace = [...messages].reverse().find(message => message.author === "bot" && message.author_avatar_url)?.author_avatar_url ?? assistant?.avatar_url;
  const staff = answeringPerson(messages);
  const title = withAssistant && assistant ? assistant.name : status === "with_staff" && staff ? staff : `Chat with ${store}`;
  const canSend = !busy && (Boolean(file) || Boolean(body.trim()));

  return (
    <>
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={false}
          aria-controls="store-chat"
          className={`fixed right-4 z-40 inline-flex size-14 items-center justify-center rounded-full bg-brand-500 text-white shadow-lg shadow-brand-500/30 transition hover:scale-105 hover:bg-brand-600 ${aboveNav ? "bottom-[calc(5rem+env(safe-area-inset-bottom))] lg:bottom-6" : "bottom-[calc(1.5rem+env(safe-area-inset-bottom))]"}`}
        >
          <MessageCircle className="size-6" aria-hidden="true" />
          <span className="sr-only">{`Chat with ${store}`}</span>
        </button>
      ) : null}
      {open ? (
        <div className="fixed inset-0 z-50">
          <button type="button" className="chat-backdrop absolute inset-0 bg-navy-950/40 backdrop-blur-[1px]" onClick={() => setOpen(false)} aria-label="Close chat" tabIndex={-1} />
          <section
            id="store-chat"
            role="dialog"
            aria-modal="true"
            aria-label={`Chat with ${store}`}
            className="chat-sheet absolute inset-x-0 bottom-0 flex h-[88svh] flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:inset-y-0 sm:right-auto sm:left-0 sm:h-svh sm:w-[420px] sm:rounded-none sm:rounded-r-3xl"
          >
            <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-slate-200 sm:hidden" aria-hidden="true" />
            <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
              <div className="flex min-w-0 items-center gap-3">
                {withAssistant ? <Avatar name={assistant?.name ?? null} author="bot" src={assistantFace} size="size-10" /> : <Avatar name={status === "with_staff" && staff ? staff : store} author="store" size="size-10" />}
                <div className="min-w-0">
                  <h2 className="flex items-center gap-1.5 truncate font-bold text-navy-900">
                    {title}
                    {withAssistant ? <span className="rounded bg-violet-100 px-1.5 text-[10px] font-semibold text-violet-700">AI assistant</span> : null}
                  </h2>
                  <p className="flex items-center gap-1.5 text-xs text-slate-500">
                    {status === "with_staff" ? <span className="size-2 rounded-full bg-emerald-500" aria-hidden="true" /> : null}
                    <span className="truncate">{chatStatusLine(status, store, staff)}</span>
                  </p>
                </div>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="inline-flex size-9 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100" aria-label="Close chat">
                <X className="size-5" aria-hidden="true" />
              </button>
            </header>

            {!loaded ? (
              <div className="grid flex-1 place-items-center bg-slate-50">
                <Loader2 className="size-6 animate-spin text-slate-400" aria-hidden="true" />
              </div>
            ) : !identity ? (
              <div className="flex-1 overflow-y-auto bg-slate-50">
                <Introduce
                  store={store}
                  onStarted={(started, who) => {
                    apply(started);
                    setIdentity("visitor");
                    setVisitor(who ?? null);
                  }}
                />
              </div>
            ) : (
              <>
                <ol className="flex-1 space-y-1 overflow-y-auto bg-slate-50 px-3 py-4" aria-live="polite" aria-label="Messages">
                  {!messages.length && assistant ? (
                    <li className="flex items-end gap-2">
                      <Avatar name={assistant.name} author="bot" src={assistant.avatar_url} />
                      <div className="max-w-[78%]">
                        <p className="px-1 pb-1 text-xs font-semibold text-navy-900">{assistant.name}</p>
                        <p className="rounded-2xl rounded-bl-md bg-violet-50 px-3.5 py-2 text-sm text-navy-900 ring-1 ring-violet-100">{assistant.greeting ?? `Hi! I’m ${assistant.name}, ${store}’s AI assistant. How can I help?`}</p>
                      </div>
                    </li>
                  ) : null}
                  {messages.map((message, index) => {
                    if (message.author === "system") {
                      return (
                        <li key={message.id} className="py-2 text-center text-xs text-slate-500">
                          <span className="rounded-full bg-white px-3 py-1 ring-1 ring-slate-200">{message.body}</span>
                        </li>
                      );
                    }
                    const ours = message.author === "customer";
                    const first = startsRun(messages, index);
                    const name = ours ? (message.author_name ?? visitor?.name ?? "You") : chatAuthor(message, store);
                    return (
                      <li key={message.id} className={`flex items-end gap-2 ${ours ? "flex-row-reverse" : ""} ${first ? "pt-2" : ""}`}>
                        {first ? <Avatar name={name} author={message.author} src={message.author === "bot" ? (message.author_avatar_url ?? assistant?.avatar_url) : null} /> : <span className="w-8 shrink-0" aria-hidden="true" />}
                        <div className={`flex max-w-[78%] flex-col gap-1 ${ours ? "items-end" : "items-start"}`}>
                          {first ? (
                            <p className="flex items-center gap-1 px-1 text-xs text-slate-500">
                              <span className="font-semibold text-navy-900">{ours ? "You" : name}</span>
                              <span>· {time(message.created_at)}</span>
                            </p>
                          ) : null}
                          {chat ? message.attachments?.map(attached => <Attachment key={attached.id} chatId={chat.id} file={attached} as={identity} ours={ours} />) : null}
                          {message.body ? (
                            <p className={`rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap break-words ${ours ? "rounded-br-md bg-navy-900 text-white" : message.author === "bot" ? "rounded-bl-md bg-violet-50 text-navy-900 ring-1 ring-violet-100" : "rounded-bl-md bg-white text-navy-900 ring-1 ring-slate-200"}`}>{message.body}</p>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                  <div ref={end} />
                </ol>
                {error ? (
                  <p role="alert" className="px-4 pt-2 text-sm text-red-700">
                    {error}
                  </p>
                ) : null}
                <form onSubmit={send} className="border-t border-slate-100 bg-white p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]" noValidate>
                  <div className="rounded-2xl border border-slate-200 bg-white p-1.5 focus-within:border-navy-900 focus-within:ring-2 focus-within:ring-navy-900/10">
                    {file ? (
                      <div className="mb-1 flex items-center gap-2 rounded-xl bg-slate-50 px-2.5 py-1.5 text-sm text-navy-900">
                        <Paperclip className="size-4 shrink-0 text-slate-500" aria-hidden="true" />
                        <span className="min-w-0 flex-1 truncate">{file.name}</span>
                        <span className="text-xs text-slate-500">{formatFileSize(file.size)}</span>
                        <button type="button" onClick={() => setFile(null)} className="grid size-6 place-items-center rounded-full text-slate-500 hover:bg-slate-200" aria-label="Remove file">
                          <X className="size-3.5" aria-hidden="true" />
                        </button>
                      </div>
                    ) : null}
                    <div className="flex items-end gap-1">
                      <button type="button" onClick={() => picker.current?.click()} disabled={busy} className="grid size-9 shrink-0 place-items-center rounded-xl text-slate-500 hover:bg-slate-100 hover:text-navy-900 disabled:opacity-50" aria-label="Attach a photo or PDF">
                        <Paperclip className="size-[18px]" aria-hidden="true" />
                      </button>
                      <input ref={picker} type="file" accept={chatFileAccept} className="hidden" onChange={event => void choose(event)} tabIndex={-1} />
                      <label htmlFor="store-chat-body" className="sr-only">
                        Message
                      </label>
                      <textarea
                        ref={area}
                        id="store-chat-body"
                        rows={1}
                        maxLength={2000}
                        value={body}
                        onChange={event => setBody(event.target.value)}
                        onKeyDown={onKey}
                        placeholder={file ? "Add a caption (optional)" : "Write a message"}
                        className="max-h-36 min-h-9 flex-1 resize-none border-0 bg-transparent px-2 py-2 text-[15px] text-navy-900 outline-none placeholder:text-slate-400 focus:ring-0"
                      />
                      <button type="submit" disabled={!canSend} className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-500 text-white transition hover:bg-brand-600 disabled:bg-slate-200 disabled:text-slate-400" aria-label="Send">
                        {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <SendHorizontal className="size-4" aria-hidden="true" />}
                      </button>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2 px-1 text-xs text-slate-500">
                    <span className="truncate">{identity === "visitor" && visitor ? `Chatting as ${visitor.name}` : "Photos and PDFs up to 4 MB"}</span>
                    <span className="flex shrink-0 items-center gap-3">
                      {chat && status === "bot" ? (
                        <button type="button" onClick={() => void person()} className="inline-flex items-center gap-1 font-semibold text-navy-900 hover:underline">
                          <UserRound className="size-3.5" aria-hidden="true" /> Talk to a person
                        </button>
                      ) : null}
                      {chat && status !== "closed" ? (
                        <button type="button" onClick={() => void finish()} className="font-semibold text-slate-600 hover:underline">
                          End chat
                        </button>
                      ) : null}
                    </span>
                  </div>
                </form>
              </>
            )}
          </section>
        </div>
      ) : null}
    </>
  );
}
