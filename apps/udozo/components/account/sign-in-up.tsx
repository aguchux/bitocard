"use client";

import Link from "next/link";
import { useActionState, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { PhoneInput } from "@bitocard/ui/phone-input";
import { CountryField, FormMessage, Submit, TextField } from "@/components/account-forms";
import {
  confirmSignupEmail,
  confirmSignupMobile,
  finishSignUp,
  type FormState,
  lookupEmail,
  sendSignupEmailCode,
  sendSignupMobileCode,
  signIn,
  type StepResult,
} from "@/lib/account-actions";
import type { Market } from "@/lib/countries";

const phoneInput =
  "min-h-12 border border-navy-200 bg-white px-3.5 text-[15px] text-navy-900 focus:border-navy-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 aria-[invalid=true]:border-brand-700";
const passwordHint = "At least 10 characters. Passwords found in data breaches are refused.";

/** A step's refusal as the forms show it. */
const shown = (result: StepResult | null): FormState => (result && !result.ok ? { error: result.error, field: result.field } : {});

function Back({ onClick, children = "Back" }: { onClick: () => void; children?: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-navy-500 hover:text-navy-900">
      <ArrowLeft className="size-4" aria-hidden="true" />
      {children}
    </button>
  );
}

function Progress({ step, of, title }: { step: number; of: number; title: string }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold tracking-wide text-brand-700 uppercase">
        Step {step} of {of} · {title}
      </p>
      <ol className="flex gap-1.5" aria-label="Sign-up steps">
        {Array.from({ length: of }, (_, index) => (
          <li key={index} className={`h-1.5 flex-1 rounded-full ${index < step ? "bg-brand-500" : "bg-navy-100"}`} aria-current={index + 1 === step ? "step" : undefined} />
        ))}
      </ol>
    </div>
  );
}

/** Whose email this is, with a way back to change it. */
function EmailChip({ email, onChange }: { email: string; onChange: () => void }) {
  return (
    <p className="flex min-h-12 items-center gap-2 rounded-xl bg-navy-50 px-3.5 text-[15px] text-navy-900">
      <span className="min-w-0 flex-1 truncate font-semibold">{email}</span>
      <button type="button" onClick={onChange} className="shrink-0 text-sm font-semibold text-brand-700 hover:underline">
        Change
      </button>
    </p>
  );
}

/**
 * Sign-in on udozo.com, one step at a time: the email first; an account uses it, then its password; none does, then an
 * offer to create one with it.
 */
export function SignInForm({ next, email: initial = "" }: { next: string; email?: string }) {
  const [step, setStep] = useState<"email" | "password" | "missing">("email");
  const [email, setEmail] = useState(initial);
  const [looked, setLooked] = useState<StepResult | null>(null);
  const [looking, startLooking] = useTransition();
  const [state, action, pending] = useActionState(signIn, {});
  const query = new URLSearchParams({ email: email.trim(), ...(next === "/" ? {} : { next }) }).toString();

  function submitEmail(event: FormEvent) {
    event.preventDefault();
    startLooking(async () => {
      const result = await lookupEmail(email);
      setLooked(result);
      if (result.ok) setStep(result.exists ? "password" : "missing");
    });
  }

  if (step === "password") {
    return (
      <form action={action} className="space-y-4">
        <input type="hidden" name="next" value={next} />
        <input type="hidden" name="email" value={email.trim()} />
        <EmailChip email={email.trim()} onChange={() => setStep("email")} />
        <FormMessage state={state} />
        <TextField label="Password" name="password" type="password" autoComplete="current-password" required autoFocus state={state} />
        <Submit pending={pending} className="w-full">
          Sign in
        </Submit>
        <Link href={`/forgot-password?email=${encodeURIComponent(email.trim())}`} className="block text-sm font-semibold text-brand-700 hover:underline">
          Forgot password?
        </Link>
      </form>
    );
  }

  if (step === "missing") {
    return (
      <div className="space-y-4">
        <EmailChip email={email.trim()} onChange={() => setStep("email")} />
        <p role="status" className="text-sm text-navy-700">
          No Udozo account uses this email yet.
        </p>
        <Link href={`/signup?${query}`} className="inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-navy-900 px-5 font-bold text-white hover:bg-navy-800">
          Create an account with it
        </Link>
        <Back onClick={() => setStep("email")}>Use another email</Back>
      </div>
    );
  }

  return (
    <form onSubmit={submitEmail} className="space-y-4">
      <FormMessage state={shown(looked)} />
      <TextField label="Email" name="email" type="email" autoComplete="email" required autoFocus value={email} onChange={event => setEmail(event.target.value)} state={shown(looked)} />
      <Submit pending={looking} className="w-full">
        Continue
      </Submit>
    </form>
  );
}

type SignUpStep = "email" | "code" | "details" | "mobile" | "mobileCode" | "password";
const stepNumber: Record<SignUpStep, [number, string]> = {
  email: [1, "Your email"],
  code: [1, "Confirm your email"],
  details: [2, "About you"],
  mobile: [3, "Your mobile"],
  mobileCode: [3, "Confirm your mobile"],
  password: [4, "Your password"],
};

/**
 * Sign-up on udozo.com, one step at a time: (1) the email, which must be free, and the code emailed to it; (2) the name
 * and the country (from Udozo's markets, fixed for good); (3) the mobile number, locked to that country, and the code
 * texted to it; (4) the password, and the account is made with both confirmed. Where the country cannot text yet, the
 * number is kept unconfirmed and step 3 asks for no code.
 */
export function SignUpForm({ next, markets, market = null, email: initial = "" }: { next: string; markets: Market[]; market?: string | null; email?: string }) {
  const [step, setStep] = useState<SignUpStep>("email");
  const [email, setEmail] = useState(initial);
  const [code, setCode] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [country, setCountry] = useState<string | null>(market && markets.some(item => item.code === market) ? market : null);
  const [phone, setPhone] = useState<string | null>(null);
  const [mobileCode, setMobileCode] = useState("");
  // The number confirmed for this sign-up, or `unconfirmed` where the country cannot text.
  const [mobile, setMobile] = useState<{ phone: string; confirmed: boolean } | null>(null);
  const [password, setPassword] = useState("");
  const [result, setResult] = useState<StepResult | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const cleanEmail = email.trim().toLowerCase();

  const go = (target: SignUpStep, message: string | null = null) => {
    setResult(null);
    setNotice(message);
    setStep(target);
  };

  /** Runs a step's action; a lost sign-up (its hour passed) starts again from the email. */
  const run = (action: () => Promise<StepResult>, then: (result: Extract<StepResult, { ok: true }>) => void) =>
    start(async () => {
      const answer = await action();
      if (!answer.ok && answer.code === "signup_token_invalid") {
        setToken(null);
        return go("email", "Your email confirmation expired. Continue to get a new code.");
      }
      setResult(answer);
      if (answer.ok) then(answer);
    });

  const sendEmailCode = (event?: FormEvent) => {
    event?.preventDefault();
    run(
      () => sendSignupEmailCode(cleanEmail),
      () => {
        setCode("");
        go("code", event ? null : "We sent you a new code.");
      },
    );
  };

  const sendMobileCode = (event?: FormEvent) => {
    event?.preventDefault();
    if (!token || !country || !phone) return;
    // Already confirmed this number: carry on.
    if (mobile?.phone === phone) return go("password");
    start(async () => {
      const answer = await sendSignupMobileCode({ email: cleanEmail, token, country, phone });
      if (!answer.ok && answer.code === "phone_verification_unavailable") {
        setMobile({ phone, confirmed: false });
        return go("password", "We cannot text numbers in your country yet, so your number is kept unconfirmed for now.");
      }
      if (!answer.ok && answer.code === "signup_token_invalid") {
        setToken(null);
        return go("email", "Your email confirmation expired. Continue to get a new code.");
      }
      setResult(answer);
      if (answer.ok) {
        setMobileCode("");
        go("mobileCode", event ? null : "We sent you a new code.");
      }
    });
  };

  const [number, title] = stepNumber[step];
  const error = shown(result);
  const emailTaken = !result?.ok && result?.code === "email_taken";
  const signInQuery = new URLSearchParams({ email: cleanEmail, ...(next === "/" ? {} : { next }) }).toString();

  return (
    <div className="space-y-4">
      <Progress step={number} of={4} title={title} />
      {notice ? <FormMessage state={{ notice }} /> : null}
      {error.error ? (
        <div className="space-y-2">
          <FormMessage state={error} />
          {emailTaken ? (
            <Link href={`/signin?${signInQuery}`} className="text-sm font-bold text-brand-700 hover:underline">
              Sign in with {cleanEmail}
            </Link>
          ) : null}
        </div>
      ) : null}

      {step === "email" ? (
        <form onSubmit={sendEmailCode} className="space-y-4">
          <TextField label="Email" name="email" type="email" autoComplete="email" required autoFocus value={email} onChange={event => setEmail(event.target.value)} state={error} hint="We email you a 6-digit code to confirm it." />
          <Submit pending={pending} className="w-full">
            Continue
          </Submit>
        </form>
      ) : null}

      {step === "code" ? (
        <form
          onSubmit={event => {
            event.preventDefault();
            run(
              () => confirmSignupEmail(cleanEmail, code),
              answer => {
                setToken(answer.token ?? null);
                go("details");
              },
            );
          }}
          className="space-y-4"
        >
          <EmailChip email={cleanEmail} onChange={() => go("email")} />
          <TextField label="6-digit code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required autoFocus value={code} onChange={event => setCode(event.target.value)} state={error} hint="It expires in 30 minutes." />
          <Submit pending={pending} className="w-full">
            Confirm email
          </Submit>
          <button type="button" onClick={() => sendEmailCode()} disabled={pending} className="min-h-11 text-sm font-semibold text-brand-700 hover:underline disabled:opacity-60">
            Send me a new code
          </button>
        </form>
      ) : null}

      {step === "details" ? (
        <form
          onSubmit={event => {
            event.preventDefault();
            go("mobile");
          }}
          className="space-y-4"
        >
          <FormMessage state={{ notice: `${cleanEmail} is confirmed.` }} />
          <TextField label="Your name" name="name" autoComplete="name" required minLength={2} maxLength={100} autoFocus value={name} onChange={event => setName(event.target.value)} state={error} />
          <CountryField
            markets={markets}
            defaultValue={country}
            state={error}
            onChange={code => {
              setCountry(code);
              // A number is checked against its country, so a new country starts it again.
              setPhone(null);
              setMobile(null);
            }}
          />
          <Submit pending={false} className="w-full">
            Continue
          </Submit>
        </form>
      ) : null}

      {step === "mobile" && country ? (
        <form onSubmit={sendMobileCode} className="space-y-4">
          <PhoneInput key={country} country={country} name="phone" label="Mobile number" defaultValue={phone ?? ""} onChange={setPhone} required className="space-y-1.5" inputClassName={phoneInput} errorClassName="text-brand-700" />
          <p className="text-xs text-navy-500">We text it a 6-digit code to confirm it.</p>
          <Submit pending={pending} className="w-full">
            {mobile?.phone === phone && phone ? "Continue" : "Text me a code"}
          </Submit>
          <Back onClick={() => go("details")} />
        </form>
      ) : null}

      {step === "mobileCode" ? (
        <form
          onSubmit={event => {
            event.preventDefault();
            if (!token) return;
            run(
              () => confirmSignupMobile({ email: cleanEmail, token, code: mobileCode }),
              answer => {
                setMobile({ phone: answer.phone ?? phone ?? "", confirmed: true });
                go("password");
              },
            );
          }}
          className="space-y-4"
        >
          <TextField label="6-digit code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required autoFocus value={mobileCode} onChange={event => setMobileCode(event.target.value)} state={error} hint={`We texted it to ${phone}. It expires in 30 minutes.`} />
          <Submit pending={pending} className="w-full">
            Confirm mobile
          </Submit>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Back onClick={() => go("mobile")}>Change number</Back>
            <button type="button" onClick={() => sendMobileCode()} disabled={pending} className="min-h-11 text-sm font-semibold text-brand-700 hover:underline disabled:opacity-60">
              Send me a new code
            </button>
          </div>
        </form>
      ) : null}

      {step === "password" ? (
        <form
          onSubmit={event => {
            event.preventDefault();
            if (!token || !country || !mobile) return;
            run(
              () => finishSignUp({ name, email: cleanEmail, country, phone: mobile.phone, password, token, next }),
              () => undefined,
            );
          }}
          className="space-y-4"
        >
          <TextField label="Password" name="password" type="password" autoComplete="new-password" required minLength={10} maxLength={128} autoFocus value={password} onChange={event => setPassword(event.target.value)} state={error} hint={passwordHint} />
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
          <Back onClick={() => go("mobile")} />
        </form>
      ) : null}
    </div>
  );
}
