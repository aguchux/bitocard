"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { Eye, EyeOff } from "lucide-react";
import {
  chooseMethod,
  confirmMethod,
  type FormState,
  forgotPassword,
  resendCode,
  resetPassword,
  sendCode,
  type SetupState,
  signIn,
  signUp,
  startGoogle,
  changePassword,
  newRecoveryCodes,
  addPhone,
  verifyPhone,
  type PhoneState,
  verifyEmail,
  verifyTwoStep,
} from "@/lib/account-actions";

const empty: FormState = {};
const field = "h-12 w-full rounded-xl border border-navy-200 bg-white px-3 text-[15px] font-medium text-navy-900 focus:border-navy-500 focus:ring-2 focus:ring-brand-500/30 aria-invalid:border-brand-700";
const submit = "h-12 rounded-2xl bg-navy-900 font-bold text-white hover:bg-navy-800 disabled:opacity-60";
const codeField = `${field} text-center text-xl tracking-[0.4em]`;

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

function Input({ label, name, state, ...props }: { label: string; name: string; state: FormState } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="grid gap-1.5 text-sm font-semibold">
      {label}
      <input name={name} required aria-invalid={state.field === name || undefined} className={field} {...props} />
    </label>
  );
}

/** A password, with a button to show or hide what was typed. */
function PasswordField({ invalid, autoComplete = "current-password", label = "Password" }: { invalid: boolean; autoComplete?: string; label?: string }) {
  const [show, setShow] = useState(false);
  return (
    <label className="grid gap-1.5 text-sm font-semibold">
      {label}
      <span className="relative">
        <input name="password" type={show ? "text" : "password"} autoComplete={autoComplete} required aria-invalid={invalid || undefined} className={`${field} pr-12`} />
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

/** The 6 digits of a code, or a recovery code where `recovery` allows one. */
function CodeField({ state, recovery = false, label = "The 6-digit code", name = "code" }: { state: FormState; recovery?: boolean; label?: string; name?: string }) {
  return (
    <label className="grid gap-1.5 text-sm font-semibold">
      {label}
      <input
        name={name}
        inputMode={recovery ? "text" : "numeric"}
        autoComplete="one-time-code"
        pattern={recovery ? "\\d{6}|[A-Za-z0-9]{4}-[A-Za-z0-9]{4}" : "\\d{6}"}
        maxLength={recovery ? 9 : 6}
        required
        aria-invalid={state.field === name || undefined}
        className={codeField}
      />
    </label>
  );
}

/** Google's "G", drawn in its colours. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="size-5" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.6 5.4 2.7 13.2l7.8 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.5 5.8c4.4-4 6.8-10 6.8-17.2z" />
      <path fill="#FBBC05" d="M10.5 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.7l-7.8-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.8l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.8 2.3-8.4 2.3-6.3 0-11.6-4.2-13.5-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z" />
    </svg>
  );
}

const googleButton = "inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl font-bold text-navy-900 ring-1 ring-navy-200 hover:ring-navy-400 disabled:opacity-60";

/** Signing in with Google (an account made with Google before): then two-step, as for any sign-in. */
export function GoogleSignIn({ next }: { next: string }) {
  const [state, action, pending] = useActionState(startGoogle, empty);
  return (
    <form action={action} className="grid gap-2">
      <input type="hidden" name="intent" value="signin" />
      <input type="hidden" name="next" value={next} />
      <Message state={state} />
      <button type="submit" disabled={pending} className={googleButton}>
        <GoogleMark /> {pending ? "Opening Google…" : "Continue with Google"}
      </button>
    </form>
  );
}

/** An Afrippa account's email and password. */
export function SignInForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(signIn, empty);
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="next" value={next} />
      <Message state={state} />
      <Input label="Email" name="email" type="email" autoComplete="email" state={state} />
      <PasswordField invalid={state.field === "password"} />
      <button type="submit" disabled={pending} className={submit}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}

/** A new account: the name, the country (fixed for good: it decides the market and currency), email and password. */
export function SignUpForm({ next, countries }: { next: string; countries: Array<{ code: string; name: string }> }) {
  const [state, action, pending] = useActionState(signUp, empty);
  const [google, startWithGoogle, opening] = useActionState(startGoogle, empty);
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="next" value={next} />
      <Message state={state.error ? state : google} />
      <Input label="Your full name" name="name" autoComplete="name" minLength={2} maxLength={100} state={state} />
      <label className="grid gap-1.5 text-sm font-semibold">
        Your country
        <select name="country" required aria-invalid={state.field === "country" || undefined} className={field} defaultValue="">
          <option value="" disabled>
            Choose your country
          </option>
          {countries.map(country => (
            <option key={country.code} value={country.code}>
              {country.name}
            </option>
          ))}
        </select>
        <span className="text-xs font-normal text-navy-500">It is your market and cannot be changed later.</span>
      </label>
      <Input label="Email" name="email" type="email" autoComplete="email" state={state} />
      <PasswordField invalid={state.field === "password"} autoComplete="new-password" />
      <button type="submit" disabled={pending} className={submit}>
        {pending ? "Creating your account…" : "Create my account"}
      </button>
      <p className="text-center text-xs font-semibold text-navy-400">or, with the country chosen above</p>
      {/* Google needs only the country: the other fields are not checked for it. */}
      <button type="submit" formAction={startWithGoogle} formNoValidate name="intent" value="signup" disabled={opening} className={googleButton}>
        <GoogleMark /> {opening ? "Opening Google…" : "Sign up with Google"}
      </button>
    </form>
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
        <CodeField state={state} />
        <button type="submit" disabled={pending} className={submit}>
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

/** Forgot password: the email, then the emailed code with the new password. */
export function ForgotPasswordForm({ next }: { next: string }) {
  const [asked, ask, asking] = useActionState<FormState & { email?: string }, FormData>(forgotPassword, {});
  const [state, reset, resetting] = useActionState(resetPassword, empty);
  if (!asked.email) {
    return (
      <form action={ask} className="grid gap-3">
        <Message state={asked} />
        <Input label="Email" name="email" type="email" autoComplete="email" state={asked} />
        <button type="submit" disabled={asking} className={submit}>
          {asking ? "Sending…" : "Email me a code"}
        </button>
      </form>
    );
  }
  return (
    <form action={reset} className="grid gap-3">
      <input type="hidden" name="next" value={next} />
      <input type="hidden" name="email" value={asked.email} />
      <Message state={state.error ? state : asked} />
      <CodeField state={state} />
      <PasswordField invalid={state.field === "password"} autoComplete="new-password" label="New password" />
      <button type="submit" disabled={resetting} className={submit}>
        {resetting ? "Saving…" : "Save my new password"}
      </button>
    </form>
  );
}

export type MethodChoice = { method: "authenticator" | "email" | "sms"; available: boolean; reason: "not_allowed" | "phone_required" | "sms_unavailable" | null };

const methodNames: Record<MethodChoice["method"], [string, string]> = {
  authenticator: ["An authenticator app", "Google Authenticator, Microsoft Authenticator, 1Password or another: the safest choice."],
  email: ["A code by email", "We email you a code each time you sign in."],
  sms: ["A code by text message", "We text a code to your confirmed mobile number."],
};

const unavailable: Record<NonNullable<MethodChoice["reason"]>, string> = {
  not_allowed: "Not offered in your country.",
  phone_required: "Confirm your mobile number first.",
  sms_unavailable: "Not available for your number yet.",
};

/**
 * Setting two-step up, required before anything else: choose a method, prove it with its first code, then keep the
 * recovery codes (shown once).
 */
export function TwoStepSetup({ methods, next, changing }: { methods: MethodChoice[]; next: string; changing?: MethodChoice["method"] }) {
  const [chosen, choose, choosing] = useActionState<SetupState, FormData>(chooseMethod, {});
  const [confirmed, confirm, confirming] = useActionState<SetupState, FormData>(confirmMethod, {});
  if (confirmed.recoveryCodes) {
    return (
      <div className="grid gap-3">
        <p className="font-semibold">Two-step sign-in is on.</p>
        <p className="text-sm text-navy-600">Keep these recovery codes somewhere safe. Each signs you in once if you lose your method. They are not shown again.</p>
        <ul className="grid grid-cols-2 gap-2 rounded-2xl bg-navy-50 p-3 font-mono text-sm" aria-label="Recovery codes">
          {confirmed.recoveryCodes.map(code => (
            <li key={code}>{code}</li>
          ))}
        </ul>
        <Link href={next} className={`${submit} grid place-items-center`}>
          I have saved them: carry on
        </Link>
      </div>
    );
  }
  if (chosen.method) {
    return (
      <form action={confirm} className="grid gap-3">
        <Message state={confirmed} />
        {chosen.method === "authenticator" ? (
          <>
            <p className="text-sm text-navy-600">Scan this with your authenticator app, or type the key in, then enter the 6-digit code it shows.</p>
            {chosen.qr ? <div className="mx-auto w-48" aria-label="QR code for your authenticator app" role="img" dangerouslySetInnerHTML={{ __html: chosen.qr }} /> : null}
            {chosen.secret ? <p className="rounded-xl bg-navy-50 p-3 text-center font-mono text-sm break-all">{chosen.secret}</p> : null}
          </>
        ) : (
          <p className="text-sm text-navy-600">We have sent a 6-digit code{chosen.sentTo ? ` to ${chosen.sentTo}` : ""}. Enter it here.</p>
        )}
        <CodeField state={confirmed} />
        <button type="submit" disabled={confirming} className={submit}>
          {confirming ? "Checking…" : "Turn two-step on"}
        </button>
      </form>
    );
  }
  return (
    <form action={choose} className="grid gap-3">
      <Message state={chosen} />
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-semibold">{changing ? "Your new method" : "How do you want to confirm it is you?"}</legend>
        {methods.map(({ method, available, reason }) => (
          <label key={method} className={`flex gap-3 rounded-2xl border border-navy-200 p-3 ${available ? "cursor-pointer hover:border-navy-400" : "opacity-60"}`}>
            <input type="radio" name="method" value={method} disabled={!available} required className="mt-1" />
            <span>
              <span className="block font-semibold">{methodNames[method][0]}</span>
              <span className="block text-sm text-navy-600">{reason ? unavailable[reason] : methodNames[method][1]}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {changing ? <CodeField state={chosen} recovery label={`A code from your current method (${methodNames[changing][0].toLowerCase()}), or a recovery code`} name="current_code" /> : null}
      <button type="submit" disabled={choosing} className={submit}>
        {choosing ? "Starting…" : "Continue"}
      </button>
    </form>
  );
}

/** Signing in with the two-step method: its code (sent on request for email and text), or a recovery code. */
export function TwoStepVerify({ method, sentTo, next }: { method: MethodChoice["method"]; sentTo: string | null; next: string }) {
  const [state, action, pending] = useActionState(verifyTwoStep, empty);
  const [sent, send, sending] = useActionState(sendCode, empty);
  return (
    <div className="grid gap-3">
      {method === "authenticator" ? (
        <p className="text-sm text-navy-600">Enter the 6-digit code your authenticator app shows for Afrippa.</p>
      ) : (
        <form action={send} className="grid gap-2">
          <p className="text-sm text-navy-600">We {method === "email" ? "email" : "text"} a code{sentTo ? ` to ${sentTo}` : ""} when you ask for one.</p>
          <Message state={sent} />
          <button type="submit" disabled={sending} className="min-h-11 justify-self-start rounded-xl px-4 font-semibold text-navy-900 ring-1 ring-navy-300 hover:ring-navy-500 disabled:opacity-60">
            {sending ? "Sending…" : "Send me a code"}
          </button>
        </form>
      )}
      <form action={action} className="grid gap-3">
        <input type="hidden" name="next" value={next} />
        <Message state={state} />
        <CodeField state={state} recovery label="The code (or a recovery code)" />
        <button type="submit" disabled={pending} className={submit}>
          {pending ? "Checking…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}

/** Changing the password: the current one, then the new one. */
export function ChangePasswordForm() {
  const [state, action, pending] = useActionState(changePassword, empty);
  return (
    <form action={action} className="grid gap-3" aria-label="Change your password">
      <Message state={state} />
      <label className="grid gap-1.5 text-sm font-semibold">
        Current password
        <input name="current_password" type="password" autoComplete="current-password" required aria-invalid={state.field === "current_password" || undefined} className={field} />
      </label>
      <PasswordField invalid={state.field === "password"} autoComplete="new-password" label="New password" />
      <button type="submit" disabled={pending} className={submit}>
        {pending ? "Saving…" : "Change my password"}
      </button>
    </form>
  );
}

/** New recovery codes, with a code from the current method; the old ones stop working. */
export function RecoveryCodesForm() {
  const [state, action, pending] = useActionState<SetupState, FormData>(newRecoveryCodes, {});
  if (state.recoveryCodes) {
    return (
      <div className="grid gap-3">
        <p className="text-sm text-navy-600">Your new recovery codes. Keep them somewhere safe: they are not shown again, and the old ones no longer work.</p>
        <ul className="grid grid-cols-2 gap-2 rounded-2xl bg-navy-50 p-3 font-mono text-sm" aria-label="Recovery codes">
          {state.recoveryCodes.map(code => (
            <li key={code}>{code}</li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <form action={action} className="grid gap-3" aria-label="New recovery codes">
      <Message state={state} />
      <CodeField state={state} recovery label="A code from your method (or a recovery code)" />
      <button type="submit" disabled={pending} className={submit}>
        {pending ? "Checking…" : "Give me new recovery codes"}
      </button>
    </form>
  );
}

/** A mobile number of the trader's country, confirmed by a texted code. */
export function PhoneForm({ current }: { current: string | null }) {
  const [state, action, pending] = useActionState<PhoneState, FormData>(addPhone, {});
  const [verified, verify, verifying] = useActionState<PhoneState, FormData>(verifyPhone, {});
  if (state.sent && !verified.notice) {
    return (
      <form action={verify} className="grid gap-3" aria-label="Confirm your mobile number">
        <Message state={verified.error ? verified : state} />
        <CodeField state={verified} />
        <button type="submit" disabled={verifying} className={submit}>
          {verifying ? "Checking…" : "Confirm my number"}
        </button>
      </form>
    );
  }
  return (
    <form action={action} className="grid gap-3" aria-label="Your mobile number">
      <Message state={verified.notice ? verified : state} />
      <Input label={current ? "A new mobile number" : "Your mobile number"} name="phone" type="tel" inputMode="tel" autoComplete="tel" maxLength={25} state={state} />
      <button type="submit" disabled={pending} className={submit}>
        {pending ? "Sending…" : "Text me a code"}
      </button>
    </form>
  );
}
