"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { AlertTriangle, ShieldCheck } from "lucide-react";

/**
 * Udozo's confirmation dialog, used before every action that changes something people cannot simply take back (paying,
 * releasing, cancelling, deleting, blocking, sharing contact details): never the browser's own `confirm` or `prompt`.
 * A native modal `<dialog>` (focus kept inside, Escape and the backdrop cancel), a sheet from the bottom on phones and
 * centred from tablets up. With `reason`, it asks for a few words too (optional unless `required`), as `prompt` did.
 */
export type ConfirmOptions = {
  title: string;
  body?: React.ReactNode;
  /** The confirming button's words: what happens ("Pay ₦25,100", "Delete listing"), never just "OK". */
  action: string;
  /** The way out, "Keep it" or "Not now"; "Cancel" by default. */
  dismiss?: string;
  /** `danger` for what destroys or takes back (red), `money` for paying out or in (green); navy otherwise. */
  tone?: "default" | "danger" | "money";
  reason?: { label: string; placeholder?: string; required?: boolean; maxLength?: number };
};
export type ConfirmResult = { reason: string } | null;

const tones = {
  default: "bg-navy-900 hover:bg-navy-700",
  danger: "bg-red-700 hover:bg-red-800",
  money: "bg-mint-700 hover:bg-mint-500",
} as const;

/** The dialog's content, apart from the `<dialog>` so it can be drawn on its own. */
export function ConfirmBody({ options, onConfirm, onDismiss, titleId }: { options: ConfirmOptions; onConfirm: (reason: string) => void; onDismiss: () => void; titleId: string }) {
  const [reason, setReason] = useState("");
  const tone = options.tone ?? "default";
  const missing = Boolean(options.reason?.required && !reason.trim());
  const Icon = tone === "money" ? ShieldCheck : AlertTriangle;
  return (
    // Never a form of its own: the dialog may sit inside the page's form (a payout, a purchase), and forms cannot nest.
    // Cancel comes first, so it is what the dialog focuses when it opens.
    <div className="grid gap-4 p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <span className={`grid size-10 shrink-0 place-items-center rounded-full ${tone === "danger" ? "bg-red-50 text-red-700" : tone === "money" ? "bg-mint-50 text-mint-700" : "bg-navy-50 text-navy-900"}`}>
          <Icon className="size-5" aria-hidden="true" />
        </span>
        <div className="grid min-w-0 gap-1">
          <h2 id={titleId} className="text-lg leading-snug font-bold text-navy-900">
            {options.title}
          </h2>
          {options.body ? <div className="text-sm text-navy-600">{options.body}</div> : null}
        </div>
      </div>
      {options.reason ? (
        <label className="grid gap-1.5 text-sm font-semibold text-navy-900">
          <span>
            {options.reason.label}
            {options.reason.required ? null : <span className="font-normal text-navy-500"> (optional)</span>}
          </span>
          <textarea
            value={reason}
            onChange={event => setReason(event.target.value)}
            rows={3}
            maxLength={options.reason.maxLength ?? 500}
            placeholder={options.reason.placeholder}
            className="rounded-xl border border-navy-200 px-3 py-2 font-normal focus:border-navy-500 focus:ring-2 focus:ring-navy-100 focus:outline-none"
          />
        </label>
      ) : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" onClick={onDismiss} className="flex h-11 items-center justify-center rounded-xl border border-navy-200 px-5 font-semibold text-navy-900 hover:bg-navy-50">
          {options.dismiss ?? "Cancel"}
        </button>
        <button type="button" disabled={missing} onClick={() => onConfirm(reason.trim())} className={`flex h-11 items-center justify-center rounded-xl px-5 font-bold text-white disabled:opacity-50 ${tones[tone]}`}>
          {options.action}
        </button>
      </div>
    </div>
  );
}

/** What answering an offer asks first: accepting fixes the price for Safe pay; declining and withdrawing end it. */
export function offerQuestion(action: "accept" | "decline" | "withdraw", price: string, name: string): ConfirmOptions {
  if (action === "accept") return { title: `Accept ${price}?`, body: `The price is agreed: the buyer can pay ${price} with Safe pay for the next 7 days. ${name} is told.`, action: `Accept ${price}`, tone: "money" };
  if (action === "decline") return { title: `Decline ${price}?`, body: `${name} is told, and can make another offer.`, action: "Decline offer", tone: "danger" };
  return { title: `Withdraw your offer of ${price}?`, body: "It can no longer be accepted. You can make another.", action: "Withdraw offer", dismiss: "Keep it", tone: "danger" };
}

/**
 * `const [confirm, dialog] = useConfirm()`: render `dialog` once, then `if (!(await confirm({ … }))) return;`. The answer
 * is `{ reason }` when confirmed (the words typed, or ""), null when dismissed.
 */
export function useConfirm(): [(options: ConfirmOptions) => Promise<ConfirmResult>, React.ReactNode] {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [asked, setAsked] = useState<{ options: ConfirmOptions; resolve: (result: ConfirmResult) => void; key: number } | null>(null);

  useEffect(() => {
    if (asked && ref.current && !ref.current.open) ref.current.showModal();
  }, [asked]);

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<ConfirmResult>(resolve => {
        // A question still open is answered "no" before the next is asked.
        setAsked(previous => {
          previous?.resolve(null);
          return { options, resolve, key: (previous?.key ?? 0) + 1 };
        });
      }),
    [],
  );

  const finish = (result: ConfirmResult) => {
    asked?.resolve(result);
    setAsked(null);
    if (ref.current?.open) ref.current.close();
  };

  const dialog = (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={event => {
        event.preventDefault();
        finish(null);
      }}
      onClick={event => {
        if (event.target === event.currentTarget) finish(null);
      }}
      className="sheet m-0 mt-auto w-full max-w-none rounded-t-3xl bg-white p-0 text-navy-900 sm:m-auto sm:max-w-md sm:rounded-3xl"
    >
      {asked ? <ConfirmBody key={asked.key} options={asked.options} titleId={titleId} onConfirm={reason => finish({ reason })} onDismiss={() => finish(null)} /> : null}
    </dialog>
  );
  return [confirm, dialog];
}
