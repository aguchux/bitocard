"use client";

import { startTransition, useActionState, useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, RefreshCw, Repeat, Send } from "lucide-react";
import { type MessageState, type RenewState, renewNumber, sendMessage, setAutoRenew } from "./actions";
import { smsCode, smsLimit } from "./sms";

/** One tap copies the code in an incoming SMS (its first 4 to 8 digits), or the whole text when it has none. */
export function CopyMessage({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const code = smsCode(text);
  return (
    <button
      type="button"
      aria-label={code ? `Copy code ${code}` : "Copy message"}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(code ?? text);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 2000);
        } catch {
          // Shown on screen to copy by hand.
        }
      }}
      className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold hover:border-slate-300"
    >
      {copied ? <Check className="size-4 text-emerald-600" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
      {copied ? "Copied" : code ? `Copy ${code}` : "Copy"}
    </button>
  );
}

/** Asks the server for the latest messages now (the page also does so every 15 seconds while it is open). */
export function RefreshInbox() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      onClick={() => start(() => router.refresh())}
      disabled={pending}
      className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-slate-200 px-3 text-sm font-semibold hover:border-slate-300"
    >
      <RefreshCw className={`size-4 ${pending ? "animate-spin" : ""}`} aria-hidden="true" />
      {pending ? "Refreshing" : "Refresh"}
    </button>
  );
}

/** Sends an SMS from the number: the recipient in international format and one message part (160, or 70 with Unicode). */
export function SendMessage({ token }: { token: string }) {
  const [state, send, pending] = useActionState<MessageState, FormData>(sendMessage, { sent: 0, error: null });
  const [to, setTo] = useState("");
  const [text, setText] = useState("");
  const [cleared, setCleared] = useState(0);
  // A message that went clears the box (the recipient stays, for a reply).
  if (state.sent !== cleared) {
    setCleared(state.sent);
    setText("");
  }
  const id = useId();
  const limit = smsLimit(text);
  const over = text.length > limit;
  return (
    <form
      onSubmit={event => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        startTransition(() => send(form));
      }}
      className="mt-6 grid gap-3 border-t border-slate-100 pt-5"
      aria-labelledby={`${id}-title`}
    >
      <h3 id={`${id}-title`} className="font-bold">
        Send a message
      </h3>
      <input type="hidden" name="token" value={token} />
      <div className="grid gap-1.5">
        <label htmlFor={`${id}-to`} className="text-sm font-semibold">
          To
        </label>
        <input
          id={`${id}-to`}
          name="to"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          required
          placeholder="+447700900123"
          value={to}
          onChange={event => setTo(event.target.value)}
          aria-describedby={`${id}-to-help`}
          className="min-h-12 w-full min-w-0 rounded-xl border border-slate-200 px-3 text-base focus:border-[#070f4c] focus:ring-2 focus:ring-[#070f4c]/15"
        />
        <p id={`${id}-to-help`} className="text-xs text-slate-500">
          In international format, starting with + and the country code.
        </p>
      </div>
      <div className="grid gap-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <label htmlFor={`${id}-text`} className="text-sm font-semibold">
            Message
          </label>
          <p id={`${id}-count`} aria-live="polite" className={`text-xs tabular-nums ${over ? "font-semibold text-red-700" : "text-slate-500"}`}>
            {text.length}/{limit}
          </p>
        </div>
        <textarea
          id={`${id}-text`}
          name="text"
          required
          rows={3}
          value={text}
          onChange={event => setText(event.target.value)}
          aria-describedby={`${id}-count ${id}-text-help`}
          aria-invalid={over || undefined}
          className="w-full min-w-0 resize-y rounded-xl border border-slate-200 px-3 py-2.5 text-base focus:border-[#070f4c] focus:ring-2 focus:ring-[#070f4c]/15"
        />
        <p id={`${id}-text-help`} className="text-xs text-slate-500">
          One text of up to 160 characters, or 70 with emoji or other special characters.
        </p>
      </div>
      {state.error ? (
        <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">
          {state.error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending || over || !text.trim() || !to.trim()}
        className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#070f4c] px-5 font-semibold text-white hover:bg-[#0b1766] disabled:opacity-60 sm:justify-self-start"
      >
        <Send className="size-4" aria-hidden="true" />
        {pending ? "Sending" : "Send"}
      </button>
    </form>
  );
}

/** Renews the number for another month now (the store pays BitoCard; the customer arranges payment with the store). */
export function RenewNumber({ token }: { token: string }) {
  const [state, renew, pending] = useActionState<RenewState, FormData>(renewNumber, { error: null });
  return (
    <form action={renew} className="grid gap-2">
      <input type="hidden" name="token" value={token} />
      <p className="text-sm text-slate-600">Renew to keep this number for another month.</p>
      <button
        type="submit"
        disabled={pending}
        className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#ff2382] px-5 font-semibold text-white hover:bg-[#e01a72] disabled:opacity-60 sm:justify-self-start"
      >
        <Repeat className="size-4" aria-hidden="true" />
        {pending ? "Renewing" : "Renew for a month"}
      </button>
      {state.error ? (
        <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

/** A switch for renewing every month, 3 days before expiry. Shows the new position while it saves. */
export function AutoRenew({ token, enabled }: { token: string; enabled: boolean }) {
  const [state, save, pending] = useActionState<RenewState, FormData>(setAutoRenew, { error: null });
  const id = useId();
  const shown = pending ? !enabled : enabled;
  return (
    <form action={save} className="grid gap-2">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="enabled" value={String(!enabled)} />
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p id={`${id}-label`} className="text-sm font-semibold">
            Renew automatically each month
          </p>
          <p id={`${id}-help`} className="text-xs text-slate-500">
            Renews 3 days before it expires.
          </p>
        </div>
        <button
          type="submit"
          role="switch"
          aria-checked={shown}
          aria-labelledby={`${id}-label`}
          aria-describedby={`${id}-help`}
          disabled={pending}
          className={`relative inline-flex h-8 w-14 shrink-0 items-center rounded-full transition-colors disabled:opacity-70 ${shown ? "bg-[#070f4c]" : "bg-slate-300"}`}
        >
          <span aria-hidden="true" className={`inline-block size-6 rounded-full bg-white shadow transition-transform ${shown ? "translate-x-7" : "translate-x-1"}`} />
        </button>
      </div>
      {state.error ? (
        <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
