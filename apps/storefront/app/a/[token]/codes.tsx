"use client";

import { useActionState, useState } from "react";
import { Check, Copy, Eye, KeyRound } from "lucide-react";
import type { AccessDelivery } from "@/lib/access";
import { revealCodes, type RevealState } from "./actions";

const detailLabels: Record<string, string> = { duration: "Licence term", expires_at: "Expires", redemption_url: "Redeem at", units: "Units" };
const names: Record<AccessDelivery["kind"], string> = { gift_card: "Code", licence_key: "Licence key", token: "Token", confirmation: "Confirmation", virtual_number: "Number" };

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={`Copy ${label.toLowerCase()}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 2000);
        } catch {
          // Shown on screen to copy by hand.
        }
      }}
      className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl border border-slate-200 px-3 text-sm font-semibold hover:border-slate-300"
    >
      {copied ? <Check className="size-4 text-emerald-600" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

/**
 * Codes, licence keys and tokens: hidden until the customer presses Reveal (the store sees when they were first
 * revealed), then each with a one-tap copy.
 */
export function Codes({ token, deliveries, instructions }: { token: string; deliveries: AccessDelivery[]; instructions: string | null }) {
  const [state, reveal, pending] = useActionState<RevealState, FormData>(revealCodes, { deliveries: null, error: null });
  const shown = state.deliveries ?? deliveries;
  const hidden = shown.some(delivery => delivery.hidden);
  return (
    <section aria-labelledby="codes" className="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm sm:p-6">
      <h2 id="codes" className="flex items-center gap-2 text-xl font-bold">
        <KeyRound className="size-5 text-[#ff2382]" aria-hidden="true" /> Your {shown.length > 1 ? `${names[shown[0].kind].toLowerCase()}s` : names[shown[0].kind].toLowerCase()}
      </h2>
      <p className="mt-1 text-sm text-slate-600">Keep {shown.length > 1 ? "them" : "it"} safe: anyone with a code can use it.</p>
      <ul className="mt-4 space-y-3">
        {shown.map((delivery, index) => (
          <li key={index} className="rounded-2xl border border-slate-200 p-4">
            <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
              {names[delivery.kind]}
              {shown.length > 1 ? ` ${index + 1}` : ""}
            </p>
            {delivery.hidden ? (
              <p aria-label="Hidden until you reveal it" className="mt-1 font-mono text-lg font-bold tracking-widest text-slate-400">
                ••••••••••••
              </p>
            ) : delivery.code ? (
              <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                <p className="min-w-0 font-mono text-lg font-bold break-all">{delivery.code}</p>
                <CopyButton value={delivery.code} label={names[delivery.kind]} />
              </div>
            ) : null}
            {!delivery.hidden && delivery.pin ? (
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm">
                  PIN: <strong className="font-mono text-base">{delivery.pin}</strong>
                </p>
                <CopyButton value={delivery.pin} label="PIN" />
              </div>
            ) : null}
            {delivery.serial ? <p className="mt-1 text-sm text-slate-600">Serial: {delivery.serial}</p> : null}
            {Object.entries(delivery.details)
              .filter(([key]) => detailLabels[key])
              .map(([key, value]) =>
                key === "redemption_url" && /^https:\/\//.test(value) ? (
                  <p key={key} className="mt-1 text-sm text-slate-600">
                    {detailLabels[key]}:{" "}
                    <a href={value} rel="noreferrer noopener" target="_blank" className="font-semibold text-[#2477ff] break-all hover:underline">
                      {value}
                    </a>
                  </p>
                ) : (
                  <p key={key} className="mt-1 text-sm text-slate-600">
                    {detailLabels[key]}: {value}
                  </p>
                ),
              )}
          </li>
        ))}
      </ul>
      {hidden ? (
        <form action={reveal} className="mt-4">
          <input type="hidden" name="token" value={token} />
          <button type="submit" disabled={pending} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#070f4c] px-5 font-semibold text-white hover:bg-[#0b1766] disabled:opacity-60 sm:w-auto">
            <Eye className="size-5" aria-hidden="true" /> {pending ? "Revealing…" : shown.length > 1 ? "Reveal codes" : "Reveal code"}
          </button>
        </form>
      ) : null}
      {state.error ? (
        <p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-800">
          {state.error}
        </p>
      ) : null}
      {instructions ? (
        <div className="mt-5 border-t border-slate-100 pt-4">
          <p className="font-semibold">How to redeem</p>
          <p className="mt-1 text-sm whitespace-pre-line text-slate-700">{instructions}</p>
        </div>
      ) : null}
    </section>
  );
}
