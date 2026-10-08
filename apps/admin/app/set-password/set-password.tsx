"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { CheckCircle2, Eye, EyeOff } from "lucide-react";
import { Button, Field, Input, Notice } from "@bitocard/admin-ui";
import { useAdminCompletePasswordLinkMutation, useAdminPasswordLinkMutation, type AdminPasswordSet } from "@bitocard/api-client/admin";
import type { ApiError } from "@bitocard/api-client";

const message = (error: unknown) => (error as ApiError | undefined)?.message ?? "Something went wrong. Try again.";

/** The token from the link's fragment (#token=…), which never reaches a server. */
function readToken() {
  return new URLSearchParams(window.location.hash.slice(1)).get("token");
}

/**
 * The set-password form for an emailed link: the admin chooses a password (twice) and, when they already have an
 * authenticator, can tick a box to reset it too. The link works once; afterwards they sign in as usual.
 */
export function SetPassword() {
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [lookup, lookupState] = useAdminPasswordLinkMutation();
  const [complete, completeState] = useAdminCompletePasswordLinkMutation();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [resetAuthenticator, setResetAuthenticator] = useState(false);
  const [mismatch, setMismatch] = useState(false);
  const [done, setDone] = useState<AdminPasswordSet | null>(null);

  const read = useRef(false);

  useEffect(() => {
    if (read.current) return;
    read.current = true;
    const value = readToken();
    setToken(value);
    // Keep the token out of the address bar and history once read.
    if (value) window.history.replaceState(null, "", window.location.pathname);
    if (value) void lookup({ token: value });
  }, [lookup]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!token) return;
    if (password !== confirm) {
      setMismatch(true);
      return;
    }
    setMismatch(false);
    const result = await complete({ token, password, reset_authenticator: resetAuthenticator }).unwrap().catch(() => null);
    if (result) setDone(result);
  }

  if (done) {
    return (
      <div className="space-y-4 text-center">
        <CheckCircle2 className="mx-auto size-12 text-emerald-600" aria-hidden />
        <h1 className="text-2xl font-extrabold tracking-tight">Password set</h1>
        <p className="text-muted">
          {done.authenticator_reset
            ? "Your authenticator was reset too: you will set it up again when you sign in."
            : lookupState.data?.kind === "create"
              ? "Sign in with your email and password, then set up your authenticator app."
              : "Sign in with your email and new password, then your authenticator code."}
        </p>
        <Link href="/signin" className="inline-flex min-h-11 items-center justify-center rounded-lg bg-brand-600 px-5 font-semibold text-white hover:bg-brand-700">
          Sign in
        </Link>
      </div>
    );
  }

  if (token === undefined || (token && lookupState.isLoading) || (token && lookupState.isUninitialized)) {
    return <p className="text-center text-muted">Checking your link…</p>;
  }

  if (!token || lookupState.error || !lookupState.data) {
    return (
      <div className="space-y-3 text-center">
        <h1 className="text-2xl font-extrabold tracking-tight">This link does not work</h1>
        <p className="text-muted">{token ? message(lookupState.error) : "Open the link from your email again. Links work once."}</p>
        <Link href="/signin" className="inline-block font-semibold text-brand-600 hover:text-brand-700">
          Go to sign in
        </Link>
      </div>
    );
  }

  const link = lookupState.data;
  const creating = link.kind === "create";
  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">{creating ? "Choose your password" : "Reset your password"}</h1>
        <p className="mt-1 text-muted">
          For <span className="font-semibold text-ink">{link.email}</span>. This link works once, until{" "}
          {new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(link.expires_at))}.
        </p>
      </div>
      {completeState.error ? <Notice tone="red">{message(completeState.error)}</Notice> : null}
      {mismatch ? <Notice tone="red">The two passwords do not match.</Notice> : null}
      {/* Lets password managers save the new password against the right account. */}
      <input type="email" name="username" autoComplete="username" value={link.email} readOnly hidden />
      <Field label="New password" htmlFor="password" hint="10 to 128 characters. Passwords found in public data breaches are refused.">
        <div className="relative">
          <Input
            id="password"
            type={show ? "text" : "password"}
            autoComplete="new-password"
            required
            minLength={10}
            maxLength={128}
            value={password}
            onChange={event => setPassword(event.target.value)}
            className="pr-12"
          />
          <button
            type="button"
            onClick={() => setShow(value => !value)}
            aria-label={show ? "Hide password" : "Show password"}
            aria-pressed={show}
            className="absolute top-1/2 right-1 grid size-10 -translate-y-1/2 place-items-center rounded-lg text-muted hover:bg-canvas hover:text-ink"
          >
            {show ? <EyeOff className="size-5" aria-hidden /> : <Eye className="size-5" aria-hidden />}
          </button>
        </div>
      </Field>
      <Field label="Confirm password" htmlFor="confirm">
        <Input id="confirm" type={show ? "text" : "password"} autoComplete="new-password" required value={confirm} onChange={event => setConfirm(event.target.value)} />
      </Field>
      {link.authenticator_set_up ? (
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-line p-4">
          <input type="checkbox" checked={resetAuthenticator} onChange={event => setResetAuthenticator(event.target.checked)} className="mt-1 size-4 accent-brand-600" />
          <span>
            <span className="block font-semibold text-ink">Also reset my authenticator app</span>
            <span className="block text-sm text-muted">Only if you lost the phone or app. You will scan a new code when you sign in, and get new recovery codes.</span>
          </span>
        </label>
      ) : null}
      <Button type="submit" className="min-h-12 w-full" loading={completeState.isLoading} disabled={password.length < 10 || !confirm}>
        {creating ? "Set password" : "Reset password"}
      </Button>
      <p className="text-center text-sm text-muted">Every session you have is signed out once the password is set.</p>
    </form>
  );
}
