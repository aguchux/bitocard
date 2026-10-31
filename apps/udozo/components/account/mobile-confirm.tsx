"use client";

import { useActionState, useState } from "react";
import { PhoneInput } from "@bitocard/ui/phone-input";
import { FormMessage, Submit, TextField } from "@/components/account-forms";
import { confirmMobile, type FormState, textMobileCode } from "@/lib/account-actions";

type Sent = FormState & { phone?: string };
const empty: Sent = {};

/**
 * The mobile number's step of confirming an account: the code texted to the number given at sign-up, a new code, or
 * another number in its place. An older account with no number types one first. Confirmed, on to `next`.
 */
export function MobileConfirmForm({ next, phone, country }: { next: string; phone: string | null; country: string }) {
  const [state, confirm, confirming] = useActionState(confirmMobile, empty);
  // A typed number and a new code to the same one are separate, so each answer is read by the form that asked.
  const [typed, textTyped, textingTyped] = useActionState(textMobileCode, empty);
  const [resent, resend, resending] = useActionState(textMobileCode, empty);
  // Typing another number until that form's next answer is a success (`typed` is then a new object without an error).
  const [typingFrom, setTypingFrom] = useState<Sent | null>(phone ? null : typed);
  const number = typed.phone ?? phone;
  const typing = !number || (typingFrom !== null && (typingFrom === typed || Boolean(typed.error)));

  if (typing) {
    return (
      <form action={textTyped} className="space-y-3">
        <FormMessage state={typed} />
        <PhoneInput
          country={country}
          name="phone"
          label="Your mobile number"
          required
          className="space-y-1.5"
          inputClassName="min-h-12 border border-navy-200 bg-white px-3.5 text-[15px] text-navy-900 focus:border-navy-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 aria-[invalid=true]:border-brand-700"
          errorClassName="text-brand-700"
        />
        <p className="text-xs text-navy-500">A mobile number from your country. We text it a 6-digit code.</p>
        <div className="flex flex-wrap items-center gap-3">
          <Submit pending={textingTyped}>Text me a code</Submit>
          {number ? (
            <button type="button" onClick={() => setTypingFrom(null)} className="text-sm font-semibold text-navy-500 hover:underline">
              Keep {number}
            </button>
          ) : null}
        </div>
      </form>
    );
  }

  const message = state.error ? state : resent.error || resent.notice ? resent : typed;
  return (
    <div className="space-y-4">
      <form action={confirm} className="space-y-4">
        <input type="hidden" name="next" value={next} />
        <FormMessage state={message} />
        <TextField
          label="6-digit code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          required
          state={state}
          hint={`We texted it to ${number}. It expires in 30 minutes.`}
        />
        <Submit pending={confirming} className="w-full">
          Confirm my mobile
        </Submit>
      </form>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <form action={resend}>
          <input type="hidden" name="phone" value={number} />
          <button type="submit" disabled={resending} className="min-h-11 text-sm font-semibold text-brand-700 hover:underline disabled:opacity-60">
            Send me a new code
          </button>
        </form>
        <button type="button" onClick={() => setTypingFrom(typed)} className="min-h-11 text-sm font-semibold text-navy-500 hover:underline">
          Use a different number
        </button>
      </div>
    </div>
  );
}
