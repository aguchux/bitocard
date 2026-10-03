"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Building2, Eye, EyeOff, Lock, Mail, User } from "lucide-react";
import { type SignUpInput, usePublicCountriesQuery, useSessionQuery, useSignUpMutation } from "@bitocard/api-client/reseller";
import { AppLink } from "@bitocard/admin-ui/shell";
import { Button, errorMessage, Notice, Select, Skeleton } from "@bitocard/admin-ui";
import { continueWithGoogle, googleErrors, GoogleMark, IconInput, safeNext } from "../signin/sign-in";

function Label({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-semibold text-ink">
      {children}
    </label>
  );
}

/**
 * Reseller sign-up: the person and their business (name and country), or, with `?invitation=`, joining the team that
 * invited them. Signs them in; the gate then asks for the code emailed to confirm the address. bitocard.com stays for
 * retail customers, so resellers sign up only here.
 *
 * "Sign up with Google" is the only way to create an account with Google (signing in with an unknown Google account
 * fails). It creates the person; the gate then onboards them (business name and country), or with an invitation they
 * return to accept it. Google errors come back here as `?auth_error=`.
 */
export function SignUp({ termsUrl, privacyUrl }: { termsUrl: string; privacyUrl: string }) {
  const router = useRouter();
  const search = useSearchParams();
  const invitation = search.get("invitation")?.trim() || null;
  // Where a signed-in person goes: with an invitation, to accept it (Google sign-ups arrive back here signed in).
  const next = safeNext(search.get("next") ?? (invitation ? `/invitations/accept?token=${encodeURIComponent(invitation)}` : null));
  const authError = search.get("auth_error");
  const session = useSessionQuery();
  const countries = usePublicCountriesQuery(undefined, { skip: Boolean(invitation) });
  const open = countries.data?.data.filter(item => item.reseller_signup) ?? [];
  const [name, setName] = useState("");
  const [business, setBusiness] = useState("");
  const [email, setEmail] = useState("");
  const [country, setCountry] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [signUp, state] = useSignUpMutation();
  const param = state.error && "param" in state.error ? state.error.param : undefined;
  const code = state.error && "code" in state.error ? state.error.code : undefined;

  useEffect(() => {
    // Already signed in: nothing to create here.
    if (session.data && !state.isSuccess) router.replace(next);
  }, [session.data, state.isSuccess, next, router]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const person = { name: name.trim(), email: email.trim(), password };
    const input: SignUpInput = invitation ? { ...person, invitation_token: invitation } : { ...person, country, ...(business.trim() ? { business_name: business.trim() } : {}) };
    const done = await signUp(input).unwrap().catch(() => null);
    // With an invitation, sign-up has already joined the team.
    if (done) router.replace(invitation ? "/" : next);
  }

  const google = () => {
    // Back to this page (without an old error), which sends the signed-in person on to `next`.
    const params = new URLSearchParams(search.toString());
    params.delete("auth_error");
    const query = params.toString();
    continueWithGoogle(`/signup${query ? `?${query}` : ""}`, "signup");
  };

  return (
    <div className="w-full max-w-md">
      <div className="mb-8 flex items-center gap-3 lg:hidden">
        {/* eslint-disable-next-line @next/next/no-img-element -- a small static logo */}
        <img src="/bitocard-logo.png" alt="" className="size-10 rounded-xl" />
        <span className="text-lg font-extrabold tracking-tight text-ink">BitoCard SHQ</span>
      </div>
      <h2 className="text-3xl font-extrabold tracking-tight text-ink">{invitation ? "Join your team" : "Create your reseller account"}</h2>
      <p className="mt-2 text-sm text-muted">
        {invitation
          ? "Create your account with the email address the invitation was sent to."
          : "Set up your store, wallet and API keys. Verification and funding come after sign-up and may take longer."}
      </p>

      <div className="mt-6 space-y-4">
        {authError ? <Notice tone="red">{googleErrors[authError] ?? "Google sign-up did not complete. Try again or use your email and a password."}</Notice> : null}
        {state.error ? (
          <Notice tone="red">
            {errorMessage(state.error)}
            {code === "email_in_use" ? (
              <>
                {" "}
                <AppLink href={`/forgot-password?email=${encodeURIComponent(email.trim())}`} className="font-semibold underline">
                  Forgotten your password?
                </AppLink>
              </>
            ) : null}
          </Notice>
        ) : null}

        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label htmlFor="name">Your full name</Label>
            <IconInput id="name" icon={User} autoComplete="name" required minLength={2} maxLength={100} value={name} onChange={event => setName(event.target.value)} aria-invalid={param === "name" || undefined} />
          </div>
          {!invitation ? (
            <div>
              <Label htmlFor="business">Business name</Label>
              <IconInput
                id="business"
                icon={Building2}
                autoComplete="organization"
                minLength={2}
                maxLength={100}
                placeholder="Optional: defaults to your name"
                value={business}
                onChange={event => setBusiness(event.target.value)}
                aria-invalid={param === "business_name" || undefined}
              />
            </div>
          ) : null}
          <div>
            <Label htmlFor="email">Email</Label>
            <IconInput id="email" icon={Mail} type="email" autoComplete="email" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} aria-invalid={param === "email" || undefined} />
          </div>
          {!invitation ? (
            <div>
              <Label htmlFor="country">Business country</Label>
              {countries.isLoading ? (
                <Skeleton className="h-14 w-full" />
              ) : countries.error ? (
                <Notice tone="red">{errorMessage(countries.error, "Could not load countries. Reload the page to try again.")}</Notice>
              ) : (
                <Select id="country" required value={country} onChange={event => setCountry(event.target.value)} className="min-h-14 rounded-lg text-base" aria-invalid={param === "country" || undefined}>
                  <option value="" disabled>
                    Choose a country
                  </option>
                  {open.map(item => (
                    <option key={item.code} value={item.code}>
                      {item.name} ({item.currency})
                    </option>
                  ))}
                </Select>
              )}
              <p className="mt-1.5 text-xs text-muted">You sell in its currency. Sign-up is open in these countries for now.</p>
            </div>
          ) : null}
          <div>
            <Label htmlFor="password">Password</Label>
            <IconInput
              id="password"
              icon={Lock}
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              required
              minLength={10}
              maxLength={128}
              value={password}
              onChange={event => setPassword(event.target.value)}
              aria-invalid={param === "password" || undefined}
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
            <p className="mt-1.5 text-xs text-muted">At least 10 characters. Passwords found in data breaches are refused.</p>
          </div>
          <p className="text-xs text-muted">
            By creating an account you agree to the{" "}
            <a href={termsUrl} target="_blank" rel="noopener" className="font-semibold text-brand-600 hover:underline">
              Terms of use
            </a>{" "}
            and confirm you have read the{" "}
            <a href={privacyUrl} target="_blank" rel="noopener" className="font-semibold text-brand-600 hover:underline">
              Privacy notice
            </a>
            .
          </p>
          <Button type="submit" className="min-h-12 w-full text-base" loading={state.isLoading || state.isSuccess} disabled={!invitation && !country}>
            {invitation ? "Create account and join" : "Create account"}
          </Button>
        </form>

        <div className="flex items-center gap-3 text-xs font-semibold tracking-wide text-subtle uppercase">
          <span className="h-px flex-1 bg-line" />
          or
          <span className="h-px flex-1 bg-line" />
        </div>
        <Button type="button" variant="secondary" className="min-h-12 w-full text-base" icon={<GoogleMark />} onClick={google}>
          Sign up with Google
        </Button>
        <p className="text-center text-xs text-muted">
          {invitation ? "Use the Google account for the email the invitation was sent to." : "You will name your business and choose its country next."}
        </p>

        <p className="pt-2 text-center text-sm text-muted">
          Already have an account?{" "}
          <AppLink href={invitation ? `/signin?next=${encodeURIComponent(`/invitations/accept?token=${invitation}`)}` : "/signin"} className="font-semibold text-brand-600 hover:underline">
            Sign in
          </AppLink>
        </p>
      </div>
    </div>
  );
}
