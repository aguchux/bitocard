"use client";

import { useActionState, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { type FormState, resendCode, signIn, verifyEmail } from "@/lib/account-actions";

const empty: FormState = {};
const field = "h-12 w-full rounded-xl border border-navy-200 bg-white px-3 text-[15px] font-medium text-navy-900 focus:border-navy-500 focus:ring-2 focus:ring-brand-500/30 aria-invalid:border-brand-700";

function Message({ state }: { state: FormState }) {
  if (state.error) {
    return (
      <p className="rounded-xl bg-brand-50 px-3 py-2.5 text-sm font-semibold text-brand-700" role="alert">
        {state.error}
      </p>
    );
  }
  return state.notice ? (
    <p className="rounded-xl bg-mint-50 px-3 py-2.5 text-sm font-semibold text-mint-700" role="status">
      {state.notice}
    </p>
  ) : null;
}

/** The email and password of the customer's BitoCard account. */
export function SignInForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(signIn, empty);
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="next" value={next} />
      <Message state={state} />
      <label className="grid gap-1.5 text-sm font-semibold">
        Email
        <input name="email" type="email" autoComplete="email" required aria-invalid={state.field === "email" || undefined} className={field} />
      </label>
      <PasswordField invalid={state.field === "password"} />
      <button type="submit" disabled={pending} className="h-12 rounded-2xl bg-navy-900 font-bold text-white hover:bg-navy-800 disabled:opacity-60">
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}

/** The password, with a button to show or hide what was typed. */
function PasswordField({ invalid }: { invalid: boolean }) {
  const [show, setShow] = useState(false);
  return (
    <label className="grid gap-1.5 text-sm font-semibold">
      Password
      <span className="relative">
        <input name="password" type={show ? "text" : "password"} autoComplete="current-password" required aria-invalid={invalid || undefined} className={`${field} pr-12`} />
        <button
          type="button"
          onClick={() => setShow(value => !value)}
          aria-label={show ? "Hide password" : "Show password"}
          aria-pressed={show}
          className="absolute top-1/2 right-1 grid size-10 -translate-y-1/2 place-items-center rounded-lg text-navy-400 hover:bg-navy-50 hover:text-navy-900"
        >
          {show ? <EyeOff className="size-5" aria-hidden="true" /> : <Eye className="size-5" aria-hidden="true" />}
        </button>
      </span>
    </label>
  );
}

/** The 6-digit code emailed to confirm the account's email, with a new code a minute apart. */
export function VerifyForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(verifyEmail, empty);
  const [resent, resend, resending] = useActionState(resendCode, empty);
  return (
    <div className="grid gap-3">
      <form action={action} className="grid gap-3">
        <input type="hidden" name="next" value={next} />
        <Message state={state} />
        <label className="grid gap-1.5 text-sm font-semibold">
          The 6-digit code
          <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required className={`${field} text-center text-xl tracking-[0.4em]`} />
        </label>
        <button type="submit" disabled={pending} className="h-12 rounded-2xl bg-navy-900 font-bold text-white hover:bg-navy-800 disabled:opacity-60">
          {pending ? "Checking…" : "Confirm my email"}
        </button>
      </form>
      <form action={resend}>
        <Message state={resent} />
        <button type="submit" disabled={resending} className="min-h-11 text-sm font-semibold text-brand-700 hover:underline disabled:opacity-60">
          Send me a new code
        </button>
      </form>
    </div>
  );
}
