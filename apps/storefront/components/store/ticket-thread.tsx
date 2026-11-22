"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import type { StoreTicket } from "@bitocard/api-client/storefront";
import { ClampedBody, FoldedThread, RichText, snippetOf } from "@bitocard/ui/rich-text";

type Message = StoreTicket["messages"][number] & { label: string };

const when = (iso: string) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

/** Each message's colours: the customer's own navy, updates dashed, the store's white. */
const tones = (message: Message) =>
  message.author === "customer"
    ? { box: "bg-navy-900 text-white", meta: "text-white/70", fade: "from-navy-900" }
    : message.author === "system"
      ? { box: "border border-dashed border-slate-200 bg-slate-50", meta: "text-slate-500", fade: "from-slate-50" }
      : { box: "bg-white ring-1 ring-slate-100", meta: "text-slate-500", fade: "from-white" };

function Face({ message }: { message: Message }) {
  if (message.author === "bot" && message.author_avatar_url) {
    // eslint-disable-next-line @next/next/no-img-element -- the assistant's uploaded picture
    return <img src={message.author_avatar_url} alt="" className="size-7 shrink-0 rounded-full object-cover ring-1 ring-violet-100" />;
  }
  const letters = message.label.split(/\s+/).map(word => word[0] ?? "").join("").slice(0, 2).toUpperCase() || "•";
  return (
    <span aria-hidden className={`grid size-7 shrink-0 place-items-center rounded-full text-[11px] font-bold ${message.author === "customer" ? "bg-brand-500 text-white" : "bg-slate-200 text-slate-700"}`}>
      {letters}
    </span>
  );
}

/**
 * A customer's conversation with their store, kept short: the newest messages in full, older ones folded to one line
 * to open, many of them behind "Show N earlier messages", and long messages cut short with Show more.
 */
export function TicketThread({ messages }: { messages: Message[] }) {
  return (
    <FoldedThread
      items={messages}
      full={(message, fold) => {
        const tone = tones(message);
        return (
          <article className={`rounded-2xl p-4 ${tone.box}`}>
            <div className={`mb-2 flex items-center gap-2.5 text-xs ${tone.meta}`}>
              <Face message={message} />
              <span className="min-w-0 flex-1">
                <strong>{message.label}</strong> · {when(message.created_at)}
              </span>
              {fold ? (
                <button type="button" onClick={fold} className="inline-flex min-h-8 items-center gap-0.5 font-semibold hover:underline">
                  <ChevronUp className="size-3.5" aria-hidden="true" /> Fold
                </button>
              ) : null}
            </div>
            <ClampedBody fade={tone.fade}>
              <RichText html={message.body_html} text={message.body} />
            </ClampedBody>
          </article>
        );
      }}
      preview={(message, open) => {
        const tone = tones(message);
        return (
          <button type="button" onClick={open} aria-label={`Open the message from ${message.label}`} className={`flex min-h-12 w-full min-w-0 items-center gap-2.5 rounded-xl px-3 py-2 text-left ${tone.box}`}>
            <Face message={message} />
            <span className="min-w-0 flex-1">
              <span className={`flex min-w-0 gap-2 text-xs ${tone.meta}`}>
                <strong className="truncate">{message.label}</strong>
                <span className="shrink-0">{when(message.created_at)}</span>
              </span>
              <span className="block truncate text-sm opacity-80">{snippetOf(message.body_html, message.body)}</span>
            </span>
            <ChevronDown className="size-4 shrink-0 opacity-60" aria-hidden="true" />
          </button>
        );
      }}
    />
  );
}
