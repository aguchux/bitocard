"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Lock, Mail } from "lucide-react";
import { useForgotPasswordMutation, useResetPasswordMutation } from "@bitocard/api-client/reseller";
import { AppLink } from "@bitocard/admin-ui/shell";
import { Button, CodeInput, errorMessage, Notice } from "@bitocard/admin-ui";
import { AuthLayout } from "@/components/auth-layout";
import { IconInput } from "../signin/sign-in";

/** Forgotten password: an emailed 6-digit code, then a new password (which signs out every other session). */
export default function ForgotPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [forgot, forgotState] = useForgotPasswordMutation();
  const [reset, resetState] = useResetPasswordMutation();

  async function requestCode(event: FormEvent) {
    event.preventDefault();
    if (await forgot({ email: email.trim() }).unwrap().catch(() => null)) setSent(true);
  }

  async function choosePassword(event: FormEvent) {
    event.preventDefault();
    const done = await reset({ email: email.trim(), code, password })
      .unwrap()
      .then(() => true)
      .catch(() => false);
    if (done) router.replace("/signin?reset=1");
  }

  return (
    <AuthLayout>
      <div className="w-full max-w-md">
        <h2 className="text-3xl font-extrabold tracking-tight text-ink">Reset your password</h2>
        <p className="mt-2 text-sm text-muted">
          {sent ? `If an account uses ${email.trim()}, we sent it a 6-digit code.` : "We will email you a code to choose a new password."}
        </p>
        <div className="mt-6 space-y-4">
          {forgotState.error ? <Notice tone="red">{errorMessage(forgotState.error)}</Notice> : null}
          {resetState.error ? <Notice tone="red">{errorMessage(resetState.error)}</Notice> : null}
          {!sent ? (
            <form onSubmit={requestCode} className="space-y-4">
              <div>
                <label htmlFor="email" className="mb-1.5 block text-sm font-semibold text-ink">
                  Email
                </label>
                <IconInput id="email" icon={Mail} type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} />
              </div>
              <Button type="submit" className="min-h-12 w-full text-base" loading={forgotState.isLoading}>
                Email me a code
              </Button>
            </form>
          ) : (
            <form onSubmit={choosePassword} className="space-y-4">
              <CodeInput label="Code from the email" value={code} onChange={setCode} autoFocus invalid={Boolean(resetState.error && "param" in resetState.error && resetState.error.param === "code")} />
              <div>
                <label htmlFor="new-password" className="mb-1.5 block text-sm font-semibold text-ink">
                  New password
                </label>
                <IconInput id="new-password" icon={Lock} type="password" autoComplete="new-password" required minLength={10} maxLength={128} value={password} onChange={event => setPassword(event.target.value)} />
                <p className="mt-1.5 text-xs text-muted">At least 10 characters. Passwords found in data breaches are refused.</p>
              </div>
              <Button type="submit" className="min-h-12 w-full text-base" loading={resetState.isLoading} disabled={code.length !== 6}>
                Choose new password
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setSent(false)}>
                Use a different email
              </Button>
            </form>
          )}
          <p className="pt-2 text-center text-sm text-muted">
            <AppLink href="/signin" className="font-semibold text-brand-600 hover:underline">
              Back to sign in
            </AppLink>
          </p>
        </div>
      </div>
    </AuthLayout>
  );
}
