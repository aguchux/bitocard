"use client";

import { useEffect, useRef, useState } from "react";

export type ConfirmOptions = {
  title: string;
  body: React.ReactNode;
  /** The button's words: what happens. */
  action: string;
  dismiss?: string;
  tone?: "danger" | "default";
  /** A box for words, required when `required`; its text is the answer. */
  reason?: { label: string; required?: boolean; placeholder?: string };
};

type Pending = ConfirmOptions & { resolve: (answer: false | { reason: string }) => void };

/**
 * Udozo Connect's own confirmation, never the browser's `confirm` or `prompt`: a native modal `<dialog>` (a sheet on
 * phones), Cancel first and focused, the button saying what happens. `const [confirm, dialog] = useConfirm()`, render
 * `dialog`, then `if (!(await confirm({ ... }))) return;`.
 */
export function useConfirm(): [(options: ConfirmOptions) => Promise<false | { reason: string }>, React.ReactNode] {
  const [pending, setPending] = useState<Pending | null>(null);
  const confirm = (options: ConfirmOptions) => new Promise<false | { reason: string }>(resolve => setPending({ ...options, resolve }));
  const close = (answer: false | { reason: string }) => {
    pending?.resolve(answer);
    setPending(null);
  };
  return [confirm, pending ? <ConfirmBody key={pending.title} {...pending} onAnswer={close} /> : null];
}

export function ConfirmBody({ title, body, action, dismiss = "Cancel", tone = "default", reason, onAnswer }: ConfirmOptions & { onAnswer: (answer: false | { reason: string }) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const [text, setText] = useState("");
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && typeof dialog.showModal === "function" && !dialog.open) dialog.showModal();
    cancel.current?.focus();
  }, []);
  const blocked = Boolean(reason?.required && !text.trim());
  return (
    <dialog
      ref={ref}
      aria-labelledby="confirm-title"
      className="sheet m-0 mt-auto w-full max-w-none rounded-t-3xl bg-white p-0 text-ink shadow-xl sm:m-auto sm:max-w-md sm:rounded-3xl"
      onCancel={event => {
        event.preventDefault();
        onAnswer(false);
      }}
    >
      <div className="p-5 sm:p-6">
        <h2 id="confirm-title" className="text-xl font-extrabold text-navy-900">
          {title}
        </h2>
        <div className="mt-2 text-slate-600">{body}</div>
        {reason ? (
          <label className="mt-4 block">
            <span className="block text-sm font-semibold text-slate-700">{reason.label}</span>
            <textarea
              value={text}
              onChange={event => setText(event.target.value)}
              rows={3}
              maxLength={300}
              placeholder={reason.placeholder}
              className="mt-1 w-full rounded-xl border border-slate-300 p-3 focus:border-navy-900 focus:ring-2 focus:ring-navy-200 focus:outline-none"
            />
          </label>
        ) : null}
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button ref={cancel} type="button" onClick={() => onAnswer(false)} className="min-h-11 rounded-xl border border-slate-200 px-4 font-semibold text-navy-900 hover:bg-slate-50">
            {dismiss}
          </button>
          <button
            type="button"
            disabled={blocked}
            onClick={() => onAnswer({ reason: text.trim() })}
            className={`min-h-11 rounded-xl px-4 font-semibold text-white disabled:opacity-50 ${tone === "danger" ? "bg-red-700 hover:bg-red-800" : "bg-navy-900 hover:bg-navy-800"}`}
          >
            {action}
          </button>
        </div>
      </div>
    </dialog>
  );
}
