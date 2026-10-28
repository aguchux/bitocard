"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { FileText, Paperclip, Send } from "lucide-react";
import { FormMessage } from "@afrippa/ui/forms";
import { type Chat, type ChatActions, type ChatState } from "@/lib/chat-types";

const time = (iso: string) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const field = "w-full rounded-xl border border-slate-200 bg-white p-3 text-[15px] text-navy-900";

/**
 * Live chat with Afrippa's team: the open chat (or a new one with the first message), polled every 4 seconds while open
 * and the tab is shown. Afrippa's team writes as "Afrippa", its assistant by its name; photos and PDFs open through this
 * site. Signed-in traders and signed-out visitors alike, each with their own actions (`actions`); a visitor not yet
 * known gives their name and email with their first message.
 */
export function HelpChat({ initial, actions, introduce = false }: { initial: Chat | null; actions: ChatActions; introduce?: boolean }) {
  const [chat, setChat] = useState(initial);
  const [file, setFile] = useState<string | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const open = chat !== null && chat.status !== "closed";
  const last = chat?.messages.at(-1)?.id ?? null;
  const [state, action, pending] = useActionState<ChatState, FormData>(async (previous, data) => {
    const answer = await actions.send(previous, data);
    if (answer.chat) {
      setChat(answer.chat);
      setFile(null);
      form.current?.reset();
    }
    return answer;
  }, {});

  useEffect(() => {
    if (!chat || !open) return;
    const timer = setInterval(async () => {
      if (document.hidden) return;
      const page = await actions.since(chat.id, last);
      if (!page) return;
      setChat(current => (current ? { ...current, status: page.status, messages: [...current.messages, ...page.data.filter(message => !current.messages.some(seen => seen.id === message.id))] } : current));
    }, 4000);
    return () => clearInterval(timer);
  }, [chat, open, last, actions]);

  return (
    <section className="space-y-3 rounded-3xl bg-white p-5 ring-1 ring-slate-200/70" aria-labelledby="chat">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="chat" className="font-display text-lg font-extrabold">
          Chat with Afrippa
        </h2>
        {open ? (
          <button
            type="button"
            onClick={async () => {
              const ended = await actions.end(chat.id);
              if (ended) setChat(ended);
            }}
            className="min-h-11 rounded-xl px-3 text-sm font-semibold ring-1 ring-slate-300 hover:ring-slate-400"
          >
            End chat
          </button>
        ) : null}
      </div>
      {chat?.messages.length ? (
        <ol className="max-h-[24rem] space-y-2 overflow-y-auto rounded-2xl bg-slate-50 p-3" aria-live="polite">
          {chat.messages.map(message =>
            message.author === "system" ? (
              <li key={message.id} className="text-center text-xs text-slate-500">
                {message.body}
              </li>
            ) : (
              <li key={message.id} className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm ${message.author === "customer" ? "ml-auto bg-navy-900 text-white" : "bg-white ring-1 ring-slate-200"}`}>
                <p className="text-xs font-semibold opacity-75">
                  {message.author === "customer" ? "You" : message.author === "bot" ? (message.author_name ?? "Afrippa's assistant") : "Afrippa"} · {time(message.created_at)}
                </p>
                {message.attachments.map(item => (
                  <a key={item.id} href={`${actions.files}/${chat.id}/${item.id}`} target="_blank" rel="noopener" className="mt-1 inline-flex items-center gap-1.5 font-semibold underline">
                    <FileText className="size-4" aria-hidden="true" /> {item.name}
                  </a>
                ))}
                {message.body ? <p className="mt-1 whitespace-pre-wrap break-words">{message.body}</p> : null}
              </li>
            ),
          )}
        </ol>
      ) : (
        <p className="text-sm text-slate-600">Write to Afrippa&apos;s team. Someone replies here as soon as they can, and we tell you when they do.</p>
      )}
      {chat?.status === "closed" && chat.ticket_reference ? <p className="text-sm text-slate-600">This chat became question {chat.ticket_reference}: see it below.</p> : null}
      <form ref={form} action={action} className="space-y-2" aria-label="Write to Afrippa">
        <FormMessage state={state.error ? state : {}} />
        {introduce && !state.chat && !chat ? (
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-sm font-semibold">
              Your name
              <input name="name" required maxLength={80} autoComplete="name" className={`${field} mt-1`} />
            </label>
            <label className="text-sm font-semibold">
              Your email
              <input name="email" type="email" required maxLength={254} autoComplete="email" className={`${field} mt-1`} />
            </label>
          </div>
        ) : null}
        <label className="sr-only" htmlFor="chat-body">
          Message
        </label>
        <textarea id="chat-body" name="body" rows={2} maxLength={2000} placeholder={open ? "Write a message" : "Start a chat"} className={field} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 text-sm font-semibold text-navy-900">
            <Paperclip className="size-4" aria-hidden="true" />
            <span>{file ?? "Attach a photo or PDF"}</span>
            <input type="file" name="file" accept="image/jpeg,image/png,application/pdf" className="sr-only" onChange={event => setFile(event.currentTarget.files?.[0]?.name ?? null)} />
          </label>
          <button type="submit" disabled={pending} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-brand-500 px-4 font-semibold text-white hover:bg-brand-600 disabled:opacity-60">
            <Send className="size-4" aria-hidden="true" /> Send
          </button>
        </div>
        <p className="text-xs text-slate-500">Never send passwords, codes or recovery codes.</p>
      </form>
    </section>
  );
}
