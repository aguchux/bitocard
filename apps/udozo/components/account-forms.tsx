"use client";

import Link from "next/link";
import { useActionState, useId, useState, type ReactNode } from "react";
import { AlertCircle, CheckCircle2, Eye, EyeOff, LoaderCircle } from "lucide-react";
import { PhoneInput } from "@bitocard/ui/phone-input";
import {
  changePassword,
  type FormState,
  forgotPassword,
  resendCode,
  resetPassword,
  setCountry,
  signIn,
  signUp,
  startVerification,
  updateName,
  verifyEmail,
} from "@/lib/account-actions";
import type { Market } from "@/lib/countries";

const empty: FormState = {};
const inputClass = "min-h-12 w-full rounded-xl border border-navy-200 bg-white px-3.5 text-[15px] text-navy-900 focus:border-navy-500 focus:ring-2 focus:ring-brand-500/30 aria-[invalid=true]:border-brand-700";
const passwordHint = "At least 10 characters. Passwords found in data breaches are refused.";

export function FormMessage({ state }: { state: FormState }) {
  if (state.error) {
    return (
      <p role="alert" className="flex items-start gap-2 rounded-xl bg-brand-50 px-3.5 py-3 text-sm font-semibold text-brand-700">
        <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        {state.error}
      </p>
    );
  }
  if (state.notice) {
    return (
      <p role="status" className="flex items-start gap-2 rounded-xl bg-mint-50 px-3.5 py-3 text-sm font-semibold text-mint-700">
        <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        {state.notice}
      </p>
    );
  }
  return null;
}

/** A labelled input; outlined when the API named it in its error. A password field gets its own show/hide toggle. */
export function TextField({
  label,
  name,
  state,
  hint,
  type,
  ...props
}: { label: string; name: string; state?: FormState; hint?: ReactNode } & React.InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  const wrong = state?.field === name;
  const [show, setShow] = useState(false);
  const isPassword = type === "password";
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-semibold text-navy-900">
        {label}
      </label>
      <div className={isPassword ? "relative" : undefined}>
        <input
          id={id}
          name={name}
          type={isPassword ? (show ? "text" : "password") : type}
          className={`${inputClass} ${isPassword ? "pr-12" : ""}`}
          aria-invalid={wrong || undefined}
          aria-describedby={hint ? `${id}-hint` : undefined}
          {...props}
        />
        {isPassword ? (
          <button
            type="button"
            onClick={() => setShow(value => !value)}
            aria-label={show ? "Hide password" : "Show password"}
            aria-pressed={show}
            className="absolute top-1/2 right-1 grid size-10 -translate-y-1/2 place-items-center rounded-lg text-navy-400 hover:bg-navy-50 hover:text-navy-900"
          >
            {show ? <EyeOff className="size-5" aria-hidden="true" /> : <Eye className="size-5" aria-hidden="true" />}
          </button>
        ) : null}
      </div>
      {hint ? (
        <p id={`${id}-hint`} className="text-xs text-navy-500">
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
      className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-navy-900 px-5 font-bold text-white hover:bg-navy-800 disabled:opacity-60 ${className}`}
    >
      {pending ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

/** The email and password of the customer's Udozo account. */
export function SignInForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(signIn, empty);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <FormMessage state={state} />
      <TextField label="Email" name="email" type="email" autoComplete="email" required state={state} />
      <TextField label="Password" name="password" type="password" autoComplete="current-password" required state={state} />
      <Submit pending={pending} className="w-full">
        Sign in
      </Submit>
    </form>
  );
}

/** The customer's country: fixed once chosen, so the hint says so. Their wallet, payouts and market follow it. */
export function CountryField({ markets, defaultValue, state, onChange }: { markets: Market[]; defaultValue?: string | null; state?: FormState; onChange?: (code: string) => void }) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-semibold text-navy-900">
        Your country
      </label>
      <select
        id={id}
        name="country"
        required
        defaultValue={defaultValue && markets.some(market => market.code === defaultValue) ? defaultValue : ""}
        onChange={onChange ? event => onChange(event.target.value) : undefined}
        aria-invalid={state?.field === "country" || undefined}
        aria-describedby={`${id}-hint`}
        className={inputClass}
      >
        <option value="" disabled>
          Choose your country
        </option>
        {markets.map(market => (
          <option key={market.code} value={market.code}>
            {market.name} ({market.currency})
          </option>
        ))}
      </select>
      <p id={`${id}-hint`} className="text-xs text-navy-500">
        You buy and sell in its market, and your wallet and payouts are in its currency. It cannot be changed later.
      </p>
    </div>
  );
}

/**
 * Sign-up on udozo.com: name, email, the country (from Udozo's markets, fixed for good), the mobile number (locked to
 * that country) and a password. The number is texted a code at once, entered after the emailed one on /verify.
 */
export function SignUpForm({ next, markets, market = null }: { next: string; markets: Market[]; market?: string | null }) {
  const [state, action, pending] = useActionState(signUp, empty);
  const [country, setChosen] = useState<string | null>(market && markets.some(item => item.code === market) ? market : null);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <FormMessage state={state} />
      <TextField label="Your name" name="name" autoComplete="name" required minLength={2} maxLength={100} state={state} />
      <TextField label="Email" name="email" type="email" autoComplete="email" required state={state} hint="We send your codes and receipts here." />
      <CountryField markets={markets} defaultValue={country} state={state} onChange={setChosen} />
      {country ? (
        <>
          <PhoneInput
            key={country}
            country={country}
            name="phone"
            label="Mobile number"
            required
            className="space-y-1.5"
            inputClassName="min-h-12 border border-navy-200 bg-white px-3.5 text-[15px] text-navy-900 focus:border-navy-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 aria-[invalid=true]:border-brand-700"
            errorClassName="text-brand-700"
          />
          <p className="text-xs text-navy-500">We text it a 6-digit code to confirm it.</p>
        </>
      ) : null}
      <TextField label="Password" name="password" type="password" autoComplete="new-password" required minLength={10} maxLength={128} state={state} hint={passwordHint} />
      <p className="text-xs text-navy-500">
        By creating an account you agree to Udozo&apos;s{" "}
        <Link href="/legal/terms" target="_blank" className="font-semibold text-navy-900 underline">
          terms of use
        </Link>{" "}
        and confirm you have read the{" "}
        <Link href="/legal/privacy" target="_blank" className="font-semibold text-navy-900 underline">
          privacy notice
        </Link>
        .
      </p>
      <Submit pending={pending} className="w-full">
        Create account
      </Submit>
    </form>
  );
}

/** The 6-digit code emailed to confirm the account's email, with a new code a minute apart. */
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
        <Submit pending={pending} className="w-full">
          Confirm my email
        </Submit>
      </form>
      <form action={resend}>
        <FormMessage state={resent} />
        <button type="submit" disabled={resending} className="min-h-11 text-sm font-semibold text-brand-700 hover:underline disabled:opacity-60">
          Send me a new code
        </button>
      </form>
    </div>
  );
}

export function ForgotForm({ email = "" }: { email?: string }) {
  const [state, action, pending] = useActionState(forgotPassword, empty);
  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <TextField label="Email" name="email" type="email" autoComplete="email" defaultValue={email} required state={state} />
      <Submit pending={pending} className="w-full">
        Email me a code
      </Submit>
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
      <Submit pending={pending} className="w-full">
        Set password and sign in
      </Submit>
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

/** Choosing the country once, for an account from before it was asked. */
export function CountryForm({ markets }: { markets: Market[] }) {
  const [state, action, pending] = useActionState(setCountry, empty);
  return (
    <form action={action} className="space-y-3">
      <FormMessage state={state} />
      <CountryField markets={markets} state={state} />
      <Submit pending={pending}>Save my country</Submit>
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

/** The identity check (Udozo Verify): a fresh link each time, since links work once. `resume`: a check is open. */
export function VerificationForm({ country, countryName, resume }: { country: string; countryName: string; resume?: boolean }) {
  const [state, action, pending] = useActionState(startVerification, empty);
  const [consent, setConsent] = useState(false);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="country" value={country} />
      <FormMessage state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="First name" name="first_name" autoComplete="given-name" required state={state} />
        <TextField label="Last name" name="last_name" autoComplete="family-name" required state={state} />
      </div>
      <p className="text-sm text-navy-600">{`We will take you to Udozo Verify to photograph an ID document from ${countryName}, take a selfie and make two short movements. It takes about five minutes. Your documents are stored encrypted and never made public.`}</p>
      <label className="flex items-start gap-3 text-sm text-navy-700">
        <input type="checkbox" name="consent" required checked={consent} onChange={event => setConsent(event.target.checked)} className="mt-1 size-4 accent-brand-500" />
        <span>
          I agree to Udozo checking my identity, including a check of my face against my ID (biometric data).{" "}
          <Link href="/legal/privacy#identity-checks" target="_blank" className="font-semibold text-navy-900 underline">
            How we use it
          </Link>
        </span>
      </label>
      <Submit pending={pending}>{resume ? "Continue your check" : "Start the check"}</Submit>
    </form>
  );
}

/** Links under the sign-in and sign-up forms. */
export function AuthLinks({ next, page }: { next: string; page: "signin" | "signup" }) {
  const query = next === "/" ? "" : `?next=${encodeURIComponent(next)}`;
  return (
    <div className="mt-4 flex flex-wrap justify-between gap-3 text-sm">
      {page === "signin" ? (
        <>
          <Link href="/forgot-password" className="font-semibold text-brand-700 hover:underline">
            Forgot password?
          </Link>
          <Link href={`/signup${query}`} className="font-bold text-brand-700 hover:underline">
            Create an account
          </Link>
        </>
      ) : (
        <Link href={`/signin${query}`} className="font-semibold text-brand-700 hover:underline">
          Already have an account? Sign in
        </Link>
      )}
    </div>
  );
}
