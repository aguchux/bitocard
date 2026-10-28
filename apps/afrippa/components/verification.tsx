"use client";

import { useActionState } from "react";
import { FormMessage, type FormState, Submit } from "@afrippa/ui/forms";
import { simulateCheck, startCheck } from "@/lib/verification";

/**
 * Starting (or carrying on with) the identity check: consent first, as the check compares the trader's face with their
 * ID (biometric data); the server sends the browser to Verify in Afrippa's name. Afrippa's privacy notice (step 5 of
 * the spin-off plan) is linked here once published, before checks open live.
 */
export function StartCheckForm({ label }: { label: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(startCheck, {});
  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <label className="flex items-start gap-3 rounded-xl p-4 text-sm ring-1 ring-slate-200">
        <input type="checkbox" name="consent" required className="mt-0.5 size-5 shrink-0 accent-brand-500" aria-invalid={state.field === "consent"} />
        <span>
          I agree to Afrippa processing my ID document and photos of my face, including a comparison of my face with my ID (biometric data), to check my identity. A
          person on Afrippa&apos;s team reviews them; they are stored privately and encrypted, and never made public.
        </span>
      </label>
      <Submit pending={pending}>{label}</Submit>
    </form>
  );
}

/** The sandbox only: finish the trader's own check with an outcome. */
export function SimulateCheck() {
  const [state, action, pending] = useActionState<FormState, FormData>(simulateCheck, {});
  return (
    <form action={action} className="space-y-3">
      <FormMessage state={state} />
      <p className="text-sm text-slate-600">Sandbox: no documents are checked. Choose the outcome.</p>
      <div className="flex flex-wrap gap-2">
        <button type="submit" name="outcome" value="approved" disabled={pending} className="inline-flex min-h-11 items-center rounded-xl bg-brand-500 px-4 text-sm font-semibold text-white disabled:opacity-60">
          Approve
        </button>
        <button type="submit" name="outcome" value="declined" disabled={pending} className="inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-semibold ring-1 ring-slate-300 disabled:opacity-60">
          Decline
        </button>
      </div>
    </form>
  );
}
