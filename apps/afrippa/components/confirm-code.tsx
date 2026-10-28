"use client";

import { useActionState } from "react";
import { FormMessage, type FormState } from "@afrippa/ui/forms";
import { sendConfirmCode } from "@/lib/account-actions";

/** The trader's two-step method (as `two_step.method` on their account). */
export type TwoStepMethod = "authenticator" | "email" | "sms" | null;

const field = "min-h-12 w-full max-w-56 rounded-xl border border-slate-200 bg-white px-3 font-mono text-lg tracking-widest text-navy-900 focus:border-navy-900 focus:ring-2 focus:ring-navy-900/15";

/**
 * A fresh two-step code inside a money form (releasing coins, adding a payment method): the authenticator's code, or an
 * emailed or texted one sent by "Send me a code" (a button of the same form, so nothing typed is lost and the form's
 * own checks wait for the real submit), or a recovery code.
 */
export function ConfirmCode({ method, state }: { method: TwoStepMethod; state: FormState }) {
  const [sent, send, sending] = useActionState<FormState, FormData>(sendConfirmCode, {});
  const sends = method === "email" || method === "sms";
  return (
    <div className="space-y-2">
      <label className="block space-y-1.5 text-sm font-semibold">
        {method === "authenticator" ? "Code from your authenticator app" : `Code we ${method === "sms" ? "text" : "email"} you`}
        <input
          name="code"
          inputMode="text"
          autoComplete="one-time-code"
          pattern="\d{6}|[A-Za-z0-9]{4}-[A-Za-z0-9]{4}"
          maxLength={9}
          required
          aria-invalid={state.field === "code" || undefined}
          className={field}
        />
      </label>
      {sends ? (
        <>
          <FormMessage state={sent} />
          <button
            type="submit"
            formAction={send}
            formNoValidate
            disabled={sending}
            className="inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-semibold text-navy-900 ring-1 ring-slate-300 hover:ring-slate-400 disabled:opacity-60"
          >
            {sending ? "Sending…" : "Send me a code"}
          </button>
        </>
      ) : null}
      <p className="text-xs text-slate-500">To keep your coins safe, we ask for a fresh code each time. Lost your method? Use a recovery code.</p>
    </div>
  );
}
