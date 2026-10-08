"use client";

import { useActionState } from "react";
import { Mail } from "lucide-react";
import { type CodeState, sendCode, verifyCode } from "./actions";

/**
 * The emailed code: first "Email me a code" (to the order's address, shown masked), then the 6 digits. A correct code
 * opens the order on this device for 30 minutes.
 */
export function EmailCodeGate({ token, emailHint }: { token: string; emailHint: string }) {
  const [sent, send, sending] = useActionState<CodeState, FormData>(sendCode, { sent: null, error: null });
  const [checked, check, checking] = useActionState<CodeState, FormData>(verifyCode, { sent: null, error: null });
  const waitingForCode = Boolean(sent.sent) || Boolean(checked.sent);
  const error = checked.error ?? sent.error;
  return (
    <section aria-labelledby="prove" className="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm sm:p-6">
      <h1 id="prove" className="flex items-center gap-2 text-xl font-bold">
        <Mail className="size-5 text-[#ff2382]" aria-hidden="true" /> Confirm it is you
      </h1>
      <p className="mt-2 text-slate-600">
        To keep your order safe, we email a code to <strong className="text-[#070f4c]">{emailHint}</strong>, the address on the order.
      </p>
      {waitingForCode ? (
        <form action={check} className="mt-5 grid gap-3 sm:max-w-sm">
          <input type="hidden" name="token" value={token} />
          <label htmlFor="code" className="text-sm font-semibold">
            The 6-digit code
          </label>
          <input
            id="code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9 ]{6,7}"
            maxLength={7}
            required
            autoFocus
            className="min-h-12 rounded-xl border border-slate-200 px-4 font-mono text-xl tracking-[0.4em] outline-none focus:border-slate-400 focus:ring-4 focus:ring-[#070f4c]/10"
          />
          <button type="submit" disabled={checking} className="inline-flex min-h-12 items-center justify-center rounded-xl bg-[#070f4c] px-5 font-semibold text-white hover:bg-[#0b1766] disabled:opacity-60">
            {checking ? "Checking…" : "Open my order"}
          </button>
        </form>
      ) : null}
      <form action={send} className="mt-4">
        <input type="hidden" name="token" value={token} />
        <button
          type="submit"
          disabled={sending}
          className={
            waitingForCode
              ? "min-h-11 text-sm font-semibold text-[#2477ff] hover:underline disabled:opacity-60"
              : "inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-[#070f4c] px-5 font-semibold text-white hover:bg-[#0b1766] disabled:opacity-60 sm:w-auto"
          }
        >
          {sending ? "Sending…" : waitingForCode ? "Send a new code" : "Email me a code"}
        </button>
      </form>
      {sent.sent && sent.sent !== "again" && !error ? (
        <p role="status" className="mt-3 text-sm text-emerald-800">
          Code sent to {sent.sent}. It works for 10 minutes.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      ) : null}
    </section>
  );
}
