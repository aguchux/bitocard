"use client";

import Link from "next/link";
import { useActionState, useId, useState, type ReactNode } from "react";
import { AlertCircle, CheckCircle2, LoaderCircle } from "lucide-react";
import {
  changePassword,
  type FormState,
  forgotPassword,
  resendCode,
  resetPassword,
  signIn,
  signUp,
  startVerification,
  updateName,
  verifyEmail,
} from "@/lib/account-actions";

const empty: FormState = {};
const inputClass = "min-h-12 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-[15px] text-[#070f4c] focus:border-[#070f4c] focus:ring-2 focus:ring-[#070f4c]/15 aria-[invalid=true]:border-red-400";

export function FormMessage({ state }: { state: FormState }) {
  if (state.error) {
    return (
      <p role="alert" className="flex items-start gap-2 rounded-xl bg-red-50 px-3.5 py-3 text-sm text-red-800">
        <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        {state.error}
      </p>
    );
  }
  if (state.notice) {
    return (
      <p role="status" className="flex items-start gap-2 rounded-xl bg-emerald-50 px-3.5 py-3 text-sm text-emerald-800">
        <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        {state.notice}
      </p>
    );
  }
  return null;
}

/** A labelled input; outlined when the API named it in its error. */
export function TextField({
  label,
  name,
  state,
  hint,
  ...props
}: { label: string; name: string; state?: FormState; hint?: ReactNode } & React.InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  const wrong = state?.field === name;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-semibold text-[#070f4c]">
        {label}
      </label>
      <input id={id} name={name} className={inputClass} aria-invalid={wrong || undefined} aria-describedby={hint ? `${id}-hint` : undefined} {...props} />
      {hint ? (
        <p id={`${id}-hint`} className="text-xs text-slate-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function Submit({ pending, children, className = "" }: { pending: boolean; children: ReactNode; className?: string }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#ff2382] px-5 font-semibold text-white hover:bg-[#e8116d] disabled:opacity-60 ${className}`}
    >
      {pending ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

const passwordHint = "At least 10 characters. Passwords found in data breaches are refused.";

export function SignInForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(signIn, empty);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <FormMessage state={state} />
      <TextField label="Email" name="email" type="email" autoComplete="email" required state={state} />
      <TextField label="Password" name="password" type="password" autoComplete="current-password" required state={state} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Submit pending={pending}>Sign in</Submit>
        <Link href="/forgot-password" className="text-sm font-semibold text-[#2477ff] hover:underline">
          Forgot your password?
        </Link>
      </div>
    </form>
  );
}

export function SignUpForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(signUp, empty);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <FormMessage state={state} />
      <TextField label="Your name" name="name" autoComplete="name" required minLength={2} maxLength={100} state={state} />
      <TextField label="Email" name="email" type="email" autoComplete="email" required state={state} hint="We send your codes and receipts here." />
      <TextField label="Password" name="password" type="password" autoComplete="new-password" required minLength={10} maxLength={128} state={state} hint={passwordHint} />
      <Submit pending={pending} className="w-full sm:w-auto">
        Create account
      </Submit>
    </form>
  );
}

export function VerifyForm({ next, email }: { next: string; email: string }) {
  const [state, action, pending] = useActionState(verifyEmail, empty);
  const [resent, resend, resending] = useActionState(resendCode, empty);
  return (
    <div className="space-y-4">
      <form action={action} className="space-y-4">
        <input type="hidden" name="next" value={next} />
        <FormMessage state={state} />
        <TextField
          label="6-digit code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          required
          state={state}
          hint={`We emailed it to ${email}. It expires in 30 minutes.`}
        />
        <Submit pending={pending}>Confirm email</Submit>
      </form>
      <form action={resend}>
        <FormMessage state={resent} />
        <button type="submit" disabled={resending} className="mt-2 text-sm font-semibold text-[#2477ff] hover:underline disabled:opacity-60">
          Send a new code
        </button>
      </form>
    </div>
  );
}

export function ForgotForm() {
  const [state, action, pending] = useActionState(forgotPassword, empty);
  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <TextField label="Email" name="email" type="email" autoComplete="email" required state={state} />
      <Submit pending={pending}>Email me a code</Submit>
    </form>
  );
}

export function ResetForm({ email }: { email: string }) {
  const [state, action, pending] = useActionState(resetPassword, empty);
  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <TextField label="Email" name="email" type="email" autoComplete="email" defaultValue={email} required state={state} />
      <TextField label="6-digit code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required state={state} hint="If an account exists for this email, we have sent it a code." />
      <TextField label="New password" name="password" type="password" autoComplete="new-password" required minLength={10} maxLength={128} state={state} hint={passwordHint} />
      <Submit pending={pending}>Set password and sign in</Submit>
    </form>
  );
}

export function NameForm({ name }: { name: string }) {
  const [state, action, pending] = useActionState(updateName, empty);
  return (
    <form action={action} className="space-y-3">
      <FormMessage state={state} />
      <TextField label="Your name" name="name" defaultValue={name} required minLength={2} maxLength={100} autoComplete="name" state={state} />
      <Submit pending={pending}>Save</Submit>
    </form>
  );
}

export function PasswordForm() {
  const [state, action, pending] = useActionState(changePassword, empty);
  return (
    <form action={action} className="space-y-3">
      <FormMessage state={state} />
      <TextField label="Current password" name="current_password" type="password" autoComplete="current-password" required state={state} />
      <TextField label="New password" name="password" type="password" autoComplete="new-password" required minLength={10} maxLength={128} state={state} hint={passwordHint} />
      <Submit pending={pending}>Change password</Submit>
    </form>
  );
}

export function VerificationForm({ country, countryName }: { country: string; countryName: string }) {
  const [state, action, pending] = useActionState(startVerification, empty);
  const [consent, setConsent] = useState(false);
  const nigeria = country === "NG";
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="country" value={country} />
      <FormMessage state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="First name" name="first_name" autoComplete="given-name" required state={state} />
        <TextField label="Last name" name="last_name" autoComplete="family-name" required state={state} />
      </div>
      {nigeria ? (
        <TextField
          label="BVN"
          name="bvn"
          inputMode="numeric"
          pattern="\d{11}"
          maxLength={11}
          required
          state={state}
          hint="Your 11-digit Bank Verification Number. You approve the check on your bank’s page; we never store your BVN."
        />
      ) : (
        <p className="text-sm text-slate-600">We will take you to our verification partner to photograph an ID document and take a selfie, for {countryName}.</p>
      )}
      <label className="flex items-start gap-3 text-sm text-slate-700">
        <input type="checkbox" name="consent" checked={consent} onChange={event => setConsent(event.target.checked)} className="mt-1 size-4 accent-[#ff2382]" />
        <span>
          I agree to BitoCard checking my identity{nigeria ? " with my BVN" : ", including a check of my face against my ID (biometric data)"}, as the privacy notice explains.
        </span>
      </label>
      <Submit pending={pending}>Start the check</Submit>
    </form>
  );
}
