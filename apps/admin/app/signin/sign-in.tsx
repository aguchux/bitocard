"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import QRCode from "qrcode";
import { Eye, EyeOff, Lock, Mail, ShieldCheck } from "lucide-react";
import { Button, cn, CodeInput, Field, Input, Notice } from "@bitocard/admin-ui";
import { useAdminMfaSetupMutation, useAdminMfaVerifyMutation, useAdminSessionQuery, useAdminSignInMutation, type MfaSetup } from "@bitocard/api-client/admin";
import type { ApiError } from "@bitocard/api-client";

/** Only same-site paths, so a crafted link cannot send an admin elsewhere after sign-in. */
export function safeNext(value: string | null) {
  return value && value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\") ? value : "/";
}

const message = (error: unknown) => (error as ApiError | undefined)?.message ?? "Something went wrong. Try again.";

/** An input with an icon on the left (and an optional control on the right), as in the sign-in design. */
function IconInput({ icon: Icon, end, className, ...props }: React.ComponentProps<typeof Input> & { icon: typeof Mail; end?: React.ReactNode }) {
  return (
    <div className="relative">
      <Icon className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-subtle" aria-hidden />
      <Input {...props} className={cn("min-h-14 rounded-lg pl-12 text-base", end ? "pr-14" : undefined, className)} />
      {end ? <div className="absolute top-1/2 right-2 -translate-y-1/2">{end}</div> : null}
    </div>
  );
}

type Step = { kind: "password" } | { kind: "code"; challenge: string; setup: MfaSetup | null } | { kind: "recovery"; codes: string[] };

/**
 * Admin sign-in: email and password, then an authenticator code (set up on first sign-in), then the one-time view of
 * recovery codes. The session is a cookie set by the API.
 */
export function SignIn() {
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));
  const session = useAdminSessionQuery();
  const [step, setStep] = useState<Step>({ kind: "password" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [code, setCode] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [signIn, signInState] = useAdminSignInMutation();
  const [setup, setupState] = useAdminMfaSetupMutation();
  const [verify, verifyState] = useAdminMfaVerifyMutation();

  useEffect(() => {
    if (session.data && step.kind === "password") router.replace(next);
  }, [session.data, step.kind, next, router]);

  useEffect(() => {
    if (step.kind !== "code" || !step.setup) return;
    let cancelled = false;
    QRCode.toDataURL(step.setup.otpauth_uri, { margin: 1, width: 200 })
      .then(url => !cancelled && setQr(url))
      .catch(() => !cancelled && setQr(null));
    return () => {
      cancelled = true;
    };
  }, [step]);

  async function submitPassword(event: FormEvent) {
    event.preventDefault();
    const challenge = await signIn({ email, password }).unwrap().catch(() => null);
    if (!challenge) return;
    const secret = challenge.mfa_setup_required ? await setup({ challenge_token: challenge.challenge_token }).unwrap().catch(() => null) : null;
    if (challenge.mfa_setup_required && !secret) return;
    setStep({ kind: "code", challenge: challenge.challenge_token, setup: secret });
  }

  async function verifyCode(value: string) {
    if (step.kind !== "code" || verifyState.isLoading) return;
    const result = await verify({ challenge_token: step.challenge, code: value.trim().toLowerCase() }).unwrap().catch(() => null);
    if (!result) {
      // Let the admin type the next code straight away.
      if (!useRecovery) setCode("");
      return;
    }
    if (result.recovery_codes?.length) setStep({ kind: "recovery", codes: result.recovery_codes });
    else router.replace(next);
  }

  function submitCode(event: FormEvent) {
    event.preventDefault();
    void verifyCode(code);
  }

  return (
    <div className="w-full max-w-md space-y-6">
      <div className="flex items-center justify-center gap-3 lg:hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/bitocard-logo.png" alt="" className="size-10 rounded-xl" />
        <span className="text-xl font-extrabold tracking-[0.2em]">BITOCARD</span>
      </div>

      {step.kind === "password" ? (
        <form onSubmit={submitPassword} className="space-y-5" noValidate>
          <div className="text-center">
            <h1 className="text-3xl font-extrabold tracking-tight text-navy-900 sm:text-4xl">Welcome back</h1>
            <p className="mt-2 text-lg text-muted">Sign in to your admin account.</p>
          </div>
          {signInState.error || setupState.error ? <Notice tone="red">{message(signInState.error ?? setupState.error)}</Notice> : null}
          <Field label="Email address" htmlFor="email" hint="Your @bitocard.com or @golojan.co.uk address.">
            <IconInput
              icon={Mail}
              id="email"
              type="email"
              autoComplete="username"
              placeholder="admin@bitocard.com"
              required
              value={email}
              onChange={event => setEmail(event.target.value)}
            />
          </Field>
          <Field label="Password" htmlFor="password">
            <IconInput
              icon={Lock}
              id="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              required
              value={password}
              onChange={event => setPassword(event.target.value)}
              end={
                <button
                  type="button"
                  onClick={() => setShowPassword(value => !value)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                  className="grid size-10 place-items-center rounded-lg text-muted hover:bg-canvas hover:text-ink"
                >
                  {showPassword ? <EyeOff className="size-5" aria-hidden /> : <Eye className="size-5" aria-hidden />}
                </button>
              }
            />
          </Field>
          <Button type="submit" className="min-h-14 w-full text-lg" loading={signInState.isLoading || setupState.isLoading}>
            Sign in
          </Button>
          <p className="text-center text-sm text-muted">
            Need access? <span className="font-semibold text-brand-600">Contact your platform administrator.</span>
          </p>
        </form>
      ) : null}

      {step.kind === "code" ? (
        <form onSubmit={submitCode} className="space-y-5" noValidate>
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight">{step.setup ? "Set up 2-step verification" : "Enter your code"}</h1>
            <p className="mt-1 text-muted">
              {step.setup
                ? "Scan this with an authenticator app (such as Google Authenticator or 1Password), then enter the 6-digit code it shows."
                : useRecovery
                  ? "Enter one of your recovery codes. Each works only once."
                  : "Enter the 6-digit code from your authenticator app."}
            </p>
          </div>
          {step.setup ? (
            <div className="flex flex-col items-center gap-3 rounded-lg border border-line bg-white p-5">
              {/* eslint-disable-next-line @next/next/no-img-element -- generated data URL */}
              {qr ? <img src={qr} alt="Authenticator QR code" className="size-48" /> : null}
              <p className="text-center text-xs text-muted">
                Can’t scan? Enter this key: <code className="break-all font-mono text-ink">{step.setup.secret}</code>
              </p>
            </div>
          ) : null}
          {verifyState.error ? <Notice tone="red">{message(verifyState.error)}</Notice> : null}
          {useRecovery ? (
            <Field label="Recovery code" htmlFor="code" hint="One of the codes you saved when you set up 2-step verification, for example abcd-1234.">
              <Input
                id="code"
                autoComplete="off"
                autoFocus
                required
                maxLength={9}
                value={code}
                onChange={event => setCode(event.target.value)}
                className="text-center font-mono text-lg tracking-[0.2em]"
              />
            </Field>
          ) : (
            <div className="space-y-2">
              <p className="text-sm font-semibold text-ink">
                Authentication code
              </p>
              <CodeInput label="Authentication code" value={code} onChange={setCode} onComplete={value => void verifyCode(value)} autoFocus invalid={Boolean(verifyState.error)} disabled={verifyState.isLoading} />
            </div>
          )}
          <Button type="submit" className="w-full" loading={verifyState.isLoading} icon={<ShieldCheck className="size-4" aria-hidden />}>
            Verify and sign in
          </Button>
          <div className="flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm font-semibold">
            {step.setup ? null : (
              <button
                type="button"
                className="text-brand-600 hover:text-brand-700"
                onClick={() => {
                  setUseRecovery(value => !value);
                  setCode("");
                }}
              >
                {useRecovery ? "Use your authenticator app" : "Use a recovery code instead"}
              </button>
            )}
            <button
              type="button"
              className="text-muted hover:text-ink"
              onClick={() => {
                setStep({ kind: "password" });
                setCode("");
                setUseRecovery(false);
              }}
            >
              Start again
            </button>
          </div>
        </form>
      ) : null}

      {step.kind === "recovery" ? (
        <div className="space-y-5">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight">Save your recovery codes</h1>
            <p className="mt-1 text-muted">Each code signs you in once if you lose your authenticator. They are shown only now.</p>
          </div>
          <ol className="grid grid-cols-2 gap-2 rounded-lg border border-line bg-white p-5 font-mono text-sm">
            {step.codes.map(item => (
              <li key={item}>{item}</li>
            ))}
          </ol>
          <Button className="w-full" onClick={() => router.replace(next)}>
            I have saved them
          </Button>
        </div>
      ) : null}

      <p className="flex items-center justify-center gap-2 pt-6 text-sm text-muted">
        <ShieldCheck className="size-5" aria-hidden />
        Protected with 2-step verification
      </p>
    </div>
  );
}
