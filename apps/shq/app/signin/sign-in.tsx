"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye, EyeOff, Lock, Mail } from "lucide-react";
import { apiBaseUrl } from "@bitocard/api-client";
import { useSessionQuery, useSignInMutation } from "@bitocard/api-client/reseller";
import { AppLink } from "@bitocard/admin-ui/shell";
import { Button, cn, errorMessage, Input, Notice } from "@bitocard/admin-ui";
import { mainSiteUrl } from "@/components/links";

/** Only same-site paths, so a crafted link cannot send a reseller elsewhere after sign-in. */
export function safeNext(value: string | null) {
  return value && value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\") ? value : "/";
}

/** An input with an icon on the left (and an optional control on the right). */
export function IconInput({ icon: Icon, end, className, ...props }: React.ComponentProps<typeof Input> & { icon: typeof Mail; end?: React.ReactNode }) {
  return (
    <div className="relative">
      <Icon className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-subtle" aria-hidden />
      <Input {...props} className={cn("min-h-14 rounded-lg pl-12 text-base", end ? "pr-14" : undefined, className)} />
      {end ? <div className="absolute top-1/2 right-2 -translate-y-1/2">{end}</div> : null}
    </div>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
      <path fill="#4285F4" d="M22.6 12.2c0-.8-.1-1.5-.2-2.2H12v4.2h5.9a5 5 0 0 1-2.2 3.3v2.7h3.6c2.1-1.9 3.3-4.8 3.3-8z" />
      <path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-2.7l-3.6-2.7c-1 .7-2.2 1-3.7 1-2.9 0-5.3-1.9-6.2-4.5H2.1v2.8A11 11 0 0 0 12 23z" />
      <path fill="#FBBC05" d="M5.8 14.1a6.6 6.6 0 0 1 0-4.2V7.1H2.1a11 11 0 0 0 0 9.8l3.7-2.8z" />
      <path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.2-3.2A11 11 0 0 0 2.1 7.1l3.7 2.8C6.7 7.3 9.1 5.4 12 5.4z" />
    </svg>
  );
}

const googleErrors: Record<string, string> = {
  google_not_configured: "Google sign-in is not available yet. Use your email and password.",
  access_denied: "Google sign-in was cancelled.",
};

/**
 * Reseller sign-in: email (or a confirmed mobile number) and password, or Google. Accounts are created on the main
 * BitoCard site, never here. The session is a cookie set by the API.
 */
export function SignIn() {
  const router = useRouter();
  const search = useSearchParams();
  const next = safeNext(search.get("next"));
  const authError = search.get("auth_error");
  const session = useSessionQuery();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [signIn, signInState] = useSignInMutation();

  useEffect(() => {
    if (session.data) router.replace(next);
  }, [session.data, next, router]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const done = await signIn({ identifier: identifier.trim(), password }).unwrap().catch(() => null);
    if (done) router.replace(next);
  }

  const google = () => {
    const returnTo = `${window.location.origin}${next}`;
    // The API's Google start page, on another origin.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign(`${apiBaseUrl()}/v1/auth/google/start?return_to=${encodeURIComponent(returnTo)}`);
  };

  return (
    <div className="w-full max-w-md">
      <div className="mb-8 flex items-center gap-3 lg:hidden">
        {/* eslint-disable-next-line @next/next/no-img-element -- a small static logo */}
        <img src="/bitocard-logo.png" alt="" className="size-10 rounded-xl" />
        <span className="text-lg font-extrabold tracking-tight text-ink">BitoCard SHQ</span>
      </div>
      <h2 className="text-3xl font-extrabold tracking-tight text-ink">Sign in</h2>
      <p className="mt-2 text-sm text-muted">Welcome back. Sign in to run your store, orders and wallet.</p>

      <div className="mt-6 space-y-4">
        {search.get("reset") ? <Notice tone="green">Your password was changed. Sign in with the new one.</Notice> : null}
        {authError ?<Notice tone="red">{googleErrors[authError] ?? "Google sign-in did not complete. Try again or use your email and password."}</Notice> : null}
        {signInState.error ? <Notice tone="red">{errorMessage(signInState.error)}</Notice> : null}

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label htmlFor="identifier" className="mb-1.5 block text-sm font-semibold text-ink">
              Email or mobile number
            </label>
            <IconInput id="identifier" icon={Mail} type="text" inputMode="email" autoComplete="username" required value={identifier} onChange={event => setIdentifier(event.target.value)} />
          </div>
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label htmlFor="password" className="block text-sm font-semibold text-ink">
                Password
              </label>
              <AppLink href="/forgot-password" className="text-sm font-semibold text-brand-600 hover:underline">
                Forgot password?
              </AppLink>
            </div>
            <IconInput
              id="password"
              icon={Lock}
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
                  className="grid size-10 place-items-center rounded-lg text-subtle hover:text-ink"
                >
                  {showPassword ? <EyeOff className="size-5" aria-hidden /> : <Eye className="size-5" aria-hidden />}
                </button>
              }
            />
          </div>
          <Button type="submit" className="min-h-12 w-full text-base" loading={signInState.isLoading}>
            Sign in
          </Button>
        </form>

        <div className="flex items-center gap-3 text-xs font-semibold tracking-wide text-subtle uppercase">
          <span className="h-px flex-1 bg-line" />
          or
          <span className="h-px flex-1 bg-line" />
        </div>
        <Button type="button" variant="secondary" className="min-h-12 w-full text-base" icon={<GoogleMark />} onClick={google}>
          Continue with Google
        </Button>

        <p className="pt-2 text-center text-sm text-muted">
          New to BitoCard?{" "}
          <a href={mainSiteUrl("/signup")} className="font-semibold text-brand-600 hover:underline">
            Create a reseller account
          </a>
        </p>
      </div>
    </div>
  );
}
