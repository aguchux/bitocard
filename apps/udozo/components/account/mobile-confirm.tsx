"use client";

import { useActionState, useState } from "react";
import { PhoneInput } from "@bitocard/ui/phone-input";
import { FormMessage, Submit, TextField, WhatsappSubmit } from "@/components/account-forms";
import {
  confirmMobile,
  confirmMobileLater,
  type FormState,
  textMobileCode,
} from "@/lib/account-actions";

type Sent = FormState & { phone?: string; channel?: "sms" | "whatsapp" };
const empty: Sent = {};

/** Carry on without the code: the account is usable, and the profile confirms the number any time. */
function ConfirmLater({ next }: { next: string }) {
  const [state, later, deferring] = useActionState(confirmMobileLater, {});
  return (
    <form
      action={later}
      className="space-y-2 rounded-xl bg-navy-50 p-3.5 text-sm text-navy-700"
    >
      <input type="hidden" name="next" value={next} />
      <FormMessage state={state} />
      <p>
        No code yet? Ask for a new one: it comes another way. Or carry on and
        confirm your number later from your profile.
      </p>
      <button
        type="submit"
        disabled={deferring}
        className="min-h-11 font-semibold text-navy-900 hover:underline disabled:opacity-60"
      >
        Skip and confirm later
      </button>
    </form>
  );
}

/**
 * The mobile number's step of confirming an account: the code texted to the number given at sign-up, a new code, or
 * another number in its place. An older account with no number types one first. Confirmed, on to `next`. It can be
 * skipped (Confirm later): the account is then usable, and the number is confirmed later from the profile.
 */
export function MobileConfirmForm({
  next,
  phone,
  country,
  whatsapp = false,
}: {
  next: string;
  phone: string | null;
  country: string;
  /** Codes can also go on WhatsApp (Udozo is on WhatsApp in the country). */
  whatsapp?: boolean;
}) {
  const [state, confirm, confirming] = useActionState(confirmMobile, empty);
  // A typed number and a new code to the same one are separate, so each answer is read by the form that asked.
  const [typed, textTyped, textingTyped] = useActionState(
    textMobileCode,
    empty,
  );
  const [resent, resend, resending] = useActionState(textMobileCode, empty);
  // Typing another number until that form's next answer is a success (`typed` is then a new object without an error).
  const [typingFrom, setTypingFrom] = useState<Sent | null>(
    phone ? null : typed,
  );
  const number = typed.phone ?? phone;
  const typing =
    !number ||
    (typingFrom !== null && (typingFrom === typed || Boolean(typed.error)));

  if (typing) {
    return (
      <div className="space-y-4">
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
          <p className="text-xs text-navy-500">
            A mobile number from your country. We send it a 6-digit code{whatsapp ? ", by text or on WhatsApp" : ""}.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Submit pending={textingTyped}>Text me a code</Submit>
            {whatsapp ? (
              <WhatsappSubmit pending={textingTyped}>Send it on WhatsApp</WhatsappSubmit>
            ) : null}
            {number ? (
              <button
                type="button"
                onClick={() => setTypingFrom(null)}
                className="text-sm font-semibold text-navy-500 hover:underline"
              >
                Keep {number}
              </button>
            ) : null}
          </div>
        </form>
        <ConfirmLater next={next} />
      </div>
    );
  }

  const message = state.error
    ? state
    : resent.error || resent.notice
      ? resent
      : typed;
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
          hint={`${(resent.notice ? resent.channel : typed.channel) === "whatsapp" ? `We sent it to ${number} on WhatsApp` : `We texted it to ${number}`}. It expires in 30 minutes.`}
        />
        <Submit pending={confirming} className="w-full">
          Confirm my mobile
        </Submit>
      </form>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <form action={resend}>
          <input type="hidden" name="phone" value={number} />
          <button
            type="submit"
            disabled={resending}
            className="min-h-11 text-sm font-semibold text-brand-700 hover:underline disabled:opacity-60"
          >
            Send me a new code
          </button>
          {whatsapp ? (
            <button
              type="submit"
              name="channel"
              value="whatsapp"
              disabled={resending}
              className="ml-4 min-h-11 text-sm font-semibold text-mint-700 hover:underline disabled:opacity-60"
            >
              Send it on WhatsApp
            </button>
          ) : null}
        </form>
        <button
          type="button"
          onClick={() => setTypingFrom(typed)}
          className="min-h-11 text-sm font-semibold text-navy-500 hover:underline"
        >
          Use a different number
        </button>
      </div>
      <ConfirmLater next={next} />
    </div>
  );
}
