"use client";

import Link from "next/link";
import { useActionState, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, Eye, EyeOff, KeyRound, LoaderCircle, X } from "lucide-react";
import {
  changePassword,
  type FormState,
  forgotPassword,
  resendCode,
  resetPassword,
  setCountry,
  setTransactionPin,
  sendTransactionPinCode,
  signIn,
  signUp,
  startVerification,
  updateName,
  unlockTransactionPin,
  verifyEmail,
  verifyTransactionPinCode,
} from "@/lib/account-actions";
import type { Market } from "@/lib/countries";
import { PhoneInput } from "@bitocard/ui/phone-input";
import { MoneyInput } from "@bitocard/ui/money-input";

const empty: FormState = {};
const inputClass = "min-h-12 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-[15px] text-navy-900 focus:border-navy-900 focus:ring-2 focus:ring-navy-900/15 aria-[invalid=true]:border-red-400";

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

type MoneyFieldProps = {
  /** An amount of money: the currency's sign inside the field, only an amount can be typed, commas as it is typed. */
  currency: string;
  /** Controlled money field: what is shown ("1,250.50") and the amount in minor units. */
  onValueChange?: (text: string, minor: number | null) => void;
};

/**
 * A labelled input; outlined when the API named it in its error. A password field gets its own show/hide toggle.
 * With `currency` it is a money field (`MoneyInput`); read its value with `parseMoney` (it carries commas).
 */
export function TextField({
  label,
  name,
  state,
  hint,
  type,
  currency,
  onValueChange,
  ...props
}: { label: string; name: string; state?: FormState; hint?: ReactNode } & Partial<MoneyFieldProps> & React.InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  const wrong = state?.field === name;
  const [show, setShow] = useState(false);
  const isPassword = type === "password";
  if (currency) {
    // MoneyInput sets its own keyboard and change handling (`onValueChange`), after these.
    const { value, defaultValue, ...rest } = props;
    return (
      <div className="space-y-1.5">
        <label htmlFor={id} className="block text-sm font-semibold text-navy-900">
          {label}
        </label>
        <MoneyInput
          id={id}
          name={name}
          currency={currency}
          className={inputClass}
          symbolClassName="text-[15px] font-semibold text-slate-500"
          aria-invalid={wrong || undefined}
          aria-describedby={hint ? `${id}-hint` : undefined}
          {...rest}
          value={value === undefined ? undefined : String(value)}
          defaultValue={defaultValue === undefined ? undefined : String(defaultValue)}
          onValueChange={onValueChange}
        />
        {hint ? (
          <p id={`${id}-hint`} className="text-xs text-slate-500">
            {hint}
          </p>
        ) : null}
      </div>
    );
  }
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
            className="absolute top-1/2 right-1 grid size-10 -translate-y-1/2 place-items-center rounded-lg text-slate-400 hover:bg-slate-50 hover:text-navy-900"
          >
            {show ? <EyeOff className="size-5" aria-hidden="true" /> : <Eye className="size-5" aria-hidden="true" />}
          </button>
        ) : null}
      </div>
      {hint ? (
        <p id={`${id}-hint`} className="text-xs text-slate-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function Submit({ pending, disabled = false, children, className = "" }: { pending: boolean; disabled?: boolean; children: ReactNode; className?: string }) {
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-brand-500 px-5 font-semibold text-white hover:bg-brand-600 disabled:opacity-60 ${className}`}
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
        <Link href="/forgot-password" className="text-sm font-semibold text-azure-500 hover:underline">
          Forgot your password?
        </Link>
      </div>
    </form>
  );
}

/**
 * The customer's country (bitocard.com): fixed once chosen, so the hint says so. Their wallet, payments and prices are
 * in its currency.
 */
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
      <p id={`${id}-hint`} className="text-xs text-slate-500">
        Your wallet, payments and prices are in its currency. It cannot be changed later.
      </p>
    </div>
  );
}

/**
 * Sign-up: on bitocard.com with the customer's country (`markets`); a reseller's store (or a market's own country
 * store) is fixed to its own, sent as `market`. The phone number is optional and locked to that country once known;
 * it is kept unverified until the customer confirms it later from their account.
 */
export function SignUpForm({ next, markets = [], market = null }: { next: string; markets?: Market[]; market?: string | null }) {
  const [state, action, pending] = useActionState(signUp, empty);
  const [country, setCountry] = useState<string | null>(market && /^[A-Z]{2}$/.test(market) ? market : null);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <FormMessage state={state} />
      <TextField label="Your name" name="name" autoComplete="name" required minLength={2} maxLength={100} state={state} />
      <TextField label="Email" name="email" type="email" autoComplete="email" required state={state} hint="We send your codes and receipts here." />
      {markets.length ? <CountryField markets={markets} defaultValue={market} state={state} onChange={setCountry} /> : null}
      {country ? (
        <PhoneInput
          country={country}
          name="phone"
          label="Mobile number"
          className="space-y-1.5"
          inputClassName="min-h-12 border border-slate-200 bg-white px-3.5 text-[15px] text-navy-900 focus:border-navy-900 focus:outline-none focus:ring-2 focus:ring-navy-900/15 aria-[invalid=true]:border-red-400"
          errorClassName="text-red-600"
        />
      ) : null}
      {country ? (
        <p className="text-xs text-slate-500">Optional. We don&apos;t verify it now — confirm it later from your account if you add it.</p>
      ) : null}
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
        <button type="submit" disabled={resending} className="mt-2 text-sm font-semibold text-azure-500 hover:underline disabled:opacity-60">
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

const pinDialogClass = "fixed inset-0 z-[70] m-auto max-h-[92vh] w-[min(92vw,34rem)] overflow-y-auto rounded-3xl bg-white p-0 text-navy-900 shadow-2xl backdrop:bg-navy-950/80";

function OtpInput({ value, onChange, invalid = false }: { value: string; onChange: (value: string) => void; invalid?: boolean }) {
  const inputs = useRef<Array<HTMLInputElement | null>>([]);
  const digits = Array.from({ length: 6 }, (_, index) => value[index] ?? "");
  const replaceDigit = (index: number, raw: string) => {
    const nextDigit = raw.replace(/\D/g, "").slice(-1);
    const next = [...digits];
    next[index] = nextDigit;
    onChange(next.join(""));
    if (nextDigit && index < 5) inputs.current[index + 1]?.focus();
  };
  const paste = (raw: string) => {
    const next = raw.replace(/\D/g, "").slice(0, 6);
    if (!next) return;
    onChange(next);
    inputs.current[Math.min(next.length, 6) - 1]?.focus();
  };
  return (
    <div>
      <span className="mb-2 block text-sm font-semibold">Email OTP</span>
      <div role="group" aria-label="Six-digit email OTP" className="grid grid-cols-6 gap-2 sm:gap-3">
        {digits.map((digit, index) => (
          <input
            key={index}
            ref={element => { inputs.current[index] = element; }}
            value={digit}
            inputMode="numeric"
            autoComplete={index === 0 ? "one-time-code" : "off"}
            pattern="[0-9]*"
            maxLength={1}
            required
            aria-label={`OTP digit ${index + 1}`}
            aria-invalid={invalid || undefined}
            className="aspect-square min-w-0 rounded-xl border border-slate-200 bg-white text-center text-xl font-bold text-navy-900 focus:border-navy-900 focus:ring-2 focus:ring-navy-900/15 aria-[invalid=true]:border-red-400"
            onFocus={event => event.currentTarget.select()}
            onChange={event => replaceDigit(index, event.target.value)}
            onPaste={event => {
              event.preventDefault();
              paste(event.clipboardData.getData("text"));
            }}
            onKeyDown={event => {
              if (event.key === "Backspace" && !digit && index > 0) {
                const next = [...digits];
                next[index - 1] = "";
                onChange(next.join(""));
                inputs.current[index - 1]?.focus();
              } else if (event.key === "ArrowLeft" && index > 0) inputs.current[index - 1]?.focus();
              else if (event.key === "ArrowRight" && index < 5) inputs.current[index + 1]?.focus();
            }}
          />
        ))}
      </div>
      <input type="hidden" name="code" value={value} />
    </div>
  );
}

export function TransactionPinDialog({ configured, required = false, id }: { configured: boolean; required?: boolean; id: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [state, action, pending] = useActionState(setTransactionPin, empty);
  const [sent, send, sending] = useActionState(sendTransactionPinCode, empty);
  const [verified, verifyCode, verifying] = useActionState(verifyTransactionPinCode, empty);
  const [step, setStep] = useState<"otp" | "pin">("otp");
  const [code, setCode] = useState("");
  const [pin, setPin] = useState("");
  const [again, setAgain] = useState("");
  const mismatch = again.length > 0 && again !== pin;
  useEffect(() => {
    if (required && !dialog.current?.open) dialog.current?.showModal();
  }, [required]);
  useEffect(() => {
    if (!verified.notice) return;
    const advance = window.setTimeout(() => setStep("pin"), 0);
    return () => window.clearTimeout(advance);
  }, [verified]);
  useEffect(() => {
    if (!state.notice) return;
    dialog.current?.close();
    router.refresh();
    const clear = window.setTimeout(() => {
      setPin("");
      setAgain("");
      setCode("");
      setStep("otp");
    }, 0);
    return () => window.clearTimeout(clear);
  }, [router, state.notice]);
  const close = () => {
    if (!required) dialog.current?.close();
  };
  const open = () => {
    setCode("");
    setPin("");
    setAgain("");
    setStep("otp");
    dialog.current?.showModal();
  };
  return (
    <>
      {!required ? (
        <button type="button" aria-haspopup="dialog" aria-controls={id} onClick={open} className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-brand-500 px-5 font-semibold text-white hover:bg-brand-600">
          <KeyRound className="size-5" aria-hidden="true" /> {configured ? "Change PIN" : "Create PIN"}
        </button>
      ) : null}
      <dialog
        ref={dialog}
        id={id}
        aria-labelledby={`${id}-title`}
        className={pinDialogClass}
        onCancel={event => {
          if (required) event.preventDefault();
        }}
        onClick={event => {
          if (event.target === dialog.current) close();
        }}
      >
        <div className="p-6 sm:p-8">
          <div className="flex items-start justify-between gap-4">
            <span className="grid size-12 place-items-center rounded-2xl bg-pink-50 text-brand-500"><KeyRound className="size-6" aria-hidden="true" /></span>
            {!required ? <button type="button" onClick={close} className="grid size-11 place-items-center rounded-full bg-slate-100 hover:bg-slate-200" aria-label="Close"><X className="size-5" aria-hidden="true" /></button> : null}
          </div>
          <h2 id={`${id}-title`} className="mt-5 text-2xl font-extrabold">{configured ? "Change transaction PIN" : "Create transaction PIN"}</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">{step === "otp" ? "First, verify the six-digit code sent to your email." : "Now choose and confirm your new six-digit transaction PIN."}</p>
          <div className="mt-5 flex items-center gap-2" aria-label={`Step ${step === "otp" ? 1 : 2} of 2`}>
            <span className={`h-2 flex-1 rounded-full ${step === "otp" ? "bg-brand-500" : "bg-emerald-500"}`} />
            <span className={`h-2 flex-1 rounded-full ${step === "pin" ? "bg-brand-500" : "bg-slate-200"}`} />
            <span className="ml-2 text-xs font-semibold text-slate-500">Step {step === "otp" ? 1 : 2} of 2</span>
          </div>
          <div className="mt-6 space-y-4">
            {step === "otp" ? (
              <>
                <form action={send} className="space-y-3">
                  <FormMessage state={sent} />
                  <Submit pending={sending}>{sent.notice ? "Send a new email code" : "Email me a code"}</Submit>
                </form>
                <form action={verifyCode} className="space-y-4">
                  <FormMessage state={verified} />
                  <OtpInput value={code} onChange={setCode} invalid={verified.field === "code" && Boolean(verified.error)} />
                  <Submit pending={verifying} disabled={code.length !== 6}>Verify code and continue</Submit>
                </form>
              </>
            ) : (
              <form action={action} className="space-y-4">
                <FormMessage state={state} />
                <TextField label="New transaction PIN" name="pin" value={pin} onChange={event => setPin(event.target.value.replace(/\D/g, "").slice(0, 6))} type="password" inputMode="numeric" autoComplete="off" pattern="\d{6}" minLength={6} maxLength={6} required state={state} hint="Choose six digits that are not repeated or consecutive." />
                <TextField label="Confirm transaction PIN" name="pin_confirmation" value={again} onChange={event => setAgain(event.target.value.replace(/\D/g, "").slice(0, 6))} type="password" inputMode="numeric" autoComplete="off" pattern="\d{6}" minLength={6} maxLength={6} required aria-invalid={mismatch || undefined} hint={mismatch ? "The two PINs are not the same." : undefined} />
                <Submit pending={pending} disabled={pin.length !== 6 || again !== pin}>{configured ? "Change transaction PIN" : "Create transaction PIN"}</Submit>
              </form>
            )}
          </div>
        </div>
      </dialog>
    </>
  );
}

function UnlockTransactionPinDialog() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [unlocked, unlock, unlocking] = useActionState(unlockTransactionPin, empty);
  useEffect(() => {
    if (unlocked.notice) dialog.current?.close();
  }, [unlocked.notice]);
  return (
    <>
      <button type="button" aria-haspopup="dialog" onClick={() => dialog.current?.showModal()} className="inline-flex min-h-12 items-center rounded-xl bg-white px-5 font-semibold text-navy-900 ring-1 ring-slate-200 hover:ring-slate-300">Unlock this device</button>
      <dialog ref={dialog} aria-labelledby="unlock-pin-title" className={pinDialogClass} onClick={event => event.target === dialog.current && dialog.current?.close()}>
        <div className="p-6 sm:p-8">
          <div className="flex justify-end"><button type="button" onClick={() => dialog.current?.close()} className="grid size-11 place-items-center rounded-full bg-slate-100 hover:bg-slate-200" aria-label="Close"><X className="size-5" aria-hidden="true" /></button></div>
          <h2 id="unlock-pin-title" className="text-2xl font-extrabold">Unlock transactions</h2>
          <p className="mt-2 text-sm text-slate-600">Enter your current PIN to approve transactions from this browser.</p>
          <form action={unlock} className="mt-6 space-y-4">
            <FormMessage state={unlocked} />
            <TextField label="Current transaction PIN" name="pin" type="password" inputMode="numeric" autoComplete="off" pattern="\d{6}" minLength={6} maxLength={6} required state={unlocked} />
            <Submit pending={unlocking}>Unlock transactions</Submit>
          </form>
        </div>
      </dialog>
    </>
  );
}

export function TransactionPinForm({ configured }: { configured: boolean }) {
  return configured ? (
    <div className="flex flex-wrap gap-3">
      <UnlockTransactionPinDialog />
      <TransactionPinDialog configured id="change-transaction-pin" />
    </div>
  ) : (
    <TransactionPinDialog configured={false} id="create-transaction-pin" />
  );
}

/** `resume`: a BitoCard Verify check is open; starting again opens a fresh link into it (links work once). */
export function VerificationForm({ country, countryName, provider, resume }: { country: string; countryName: string; provider?: "bitocard" | "didit"; resume?: boolean }) {
  const [state, action, pending] = useActionState(startVerification, empty);
  const [consent, setConsent] = useState(false);
  // BitoCard Verify needs no BVN; the BVN check is asked only where it does not run.
  const ours = provider === "bitocard";
  const nigeria = country === "NG" && !ours;
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="country" value={country} />
      {provider ? <input type="hidden" name="provider" value={provider} /> : null}
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
      ) : ours ? (
        <div className="space-y-2 text-sm text-slate-600">
          <p>{`We will take you to BitoCard Verify to photograph an ID document from ${countryName}, take a selfie and make two short movements. It takes about five minutes.`}</p>
          <p>BitoCard reviews your documents. If this store is a registered business that BitoCard has verified, its team may review them instead. They are stored encrypted and never made public.</p>
        </div>
      ) : (
        <p className="text-sm text-slate-600">We will take you to our verification partner to photograph an ID document and take a selfie, for {countryName}.</p>
      )}
      <label className="flex items-start gap-3 text-sm text-slate-700">
        <input type="checkbox" name="consent" checked={consent} onChange={event => setConsent(event.target.checked)} className="mt-1 size-4 accent-brand-500" />
        <span>
          I agree to BitoCard checking my identity{nigeria ? " with my BVN" : ", including a check of my face against my ID (biometric data)"}, as the privacy notice explains.
        </span>
      </label>
      <Submit pending={pending}>{resume ? "Continue your check" : "Start the check"}</Submit>
      {resume ? (
        <div className="space-y-1 border-t border-slate-100 pt-4">
          <button type="submit" name="restart" value="1" disabled={pending} className="inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-60">
            Start again
          </button>
          <p className="text-sm text-slate-500">Stuck? This closes your unfinished check and deletes what you sent, so you begin from the first step. A check with no progress for three days closes on its own.</p>
        </div>
      ) : null}
    </form>
  );
}
