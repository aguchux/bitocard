"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Building2, Eye, EyeOff, Lock, Mail, User } from "lucide-react";
import {
  type SignUpInput,
  usePublicCountriesQuery,
  useSessionQuery,
  useSignUpMutation,
  useStartSignupEmailMutation,
  useVerifySignupEmailMutation,
} from "@bitocard/api-client/reseller";
import { AppLink } from "@bitocard/admin-ui/shell";
import { Button, CodeInput, cn, errorMessage, Notice, Select, Skeleton, Wordmark } from "@bitocard/admin-ui";
import { continueWithGoogle, googleErrors, GoogleMark, IconInput, safeNext } from "../signin/sign-in";

type Step = "details" | "verify" | "business" | "password";

const stepTitles: Record<Step, string> = {
  details: "Your details",
  verify: "Confirm your email",
  business: "Your business",
  password: "Choose a password",
};

type ApiFailure = { code?: string; param?: string } | undefined;
const failure = (error: unknown): ApiFailure => (error && typeof error === "object" ? (error as ApiFailure) : undefined);

function Label({ htmlFor, children }: { htmlFor: string; children: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-semibold text-ink">
      {children}
    </label>
  );
}

function Progress({ steps, current }: { steps: Step[]; current: Step }) {
  const index = steps.indexOf(current);
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold tracking-wide text-brand-600 uppercase">
        Step {index + 1} of {steps.length} · {stepTitles[current]}
      </p>
      <ol className="flex gap-1.5" aria-label="Sign-up steps">
        {steps.map((step, i) => (
          <li key={step} className={cn("h-1.5 flex-1 rounded-full", i <= index ? "bg-brand-500" : "bg-line")} aria-current={step === current ? "step" : undefined}>
            <span className="sr-only">
              {stepTitles[step]}
              {i < index ? " (done)" : ""}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * Reseller sign-up, one step at a time: (1) first name, last name and email; (2) the code emailed to confirm it, before
 * any account exists; (3) business name and country; (4) password, then the account is created already confirmed.
 * With `?invitation=` it is details then password, and the account joins the inviting team (the link proves the
 * email). bitocard.com stays for retail customers, so resellers sign up only here.
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
  const steps: Step[] = invitation ? ["details", "password"] : ["details", "verify", "business", "password"];

  const session = useSessionQuery();
  const countries = usePublicCountriesQuery(undefined, { skip: Boolean(invitation) });
  const open = countries.data?.data.filter(item => item.reseller_signup) ?? [];
  const [step, setStep] = useState<Step>("details");
  const [notice, setNotice] = useState<string | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  // The confirmed email and its sign-up token (one hour, once).
  const [confirmed, setConfirmed] = useState<{ email: string; token: string } | null>(null);
  const [business, setBusiness] = useState("");
  const [country, setCountry] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [startEmail, startState] = useStartSignupEmailMutation();
  const [verifyEmail, verifyState] = useVerifySignupEmailMutation();
  const [signUp, signUpState] = useSignUpMutation();
  const cleanEmail = email.trim().toLowerCase();

  useEffect(() => {
    // Already signed in: nothing to create here.
    if (session.data && !signUpState.isSuccess) router.replace(next);
  }, [session.data, signUpState.isSuccess, next, router]);

  const go = (target: Step, message: string | null = null) => {
    setNotice(message);
    startState.reset();
    verifyState.reset();
    signUpState.reset();
    setStep(target);
  };

  async function submitDetails(event: FormEvent) {
    event.preventDefault();
    if (invitation) return go("password");
    // Already confirmed this address: carry on.
    if (confirmed?.email === cleanEmail) return go("business");
    const sent = await startEmail({ email: cleanEmail })
      .unwrap()
      .catch(() => null);
    if (sent) {
      setCode("");
      go("verify");
    }
  }

  async function submitCode(value: string) {
    if (verifyState.isLoading || value.length !== 6) return;
    const result = await verifyEmail({ email: cleanEmail, code: value })
      .unwrap()
      .catch(() => null);
    if (!result) return setCode("");
    setConfirmed({ email: cleanEmail, token: result.signup_token });
    go("business");
  }

  async function resend() {
    setCode("");
    const sent = await startEmail({ email: cleanEmail })
      .unwrap()
      .catch(() => null);
    if (sent) setNotice("A new code is on its way.");
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    const person = { name: `${firstName.trim()} ${lastName.trim()}`, email: cleanEmail, password };
    const input: SignUpInput = invitation
      ? { ...person, invitation_token: invitation }
      : { ...person, country, business_name: business.trim(), ...(confirmed ? { signup_token: confirmed.token } : {}) };
    const done = await signUp(input)
      .unwrap()
      .catch((error: unknown) => {
        // Send the person back to the step that needs fixing.
        const { code: errorCode, param } = failure(error) ?? {};
        if (errorCode === "signup_token_invalid") {
          setConfirmed(null);
          go("details", "Your email confirmation expired. Continue to get a new code.");
        } else if (param === "country" || param === "business_name") go("business");
        else if (param === "email" || param === "name") go("details");
        return null;
      });
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

  const error = startState.error ?? verifyState.error ?? signUpState.error;
  const errorCode = failure(error)?.code;
  const back = (target: Step) => (
    <Button type="button" variant="ghost" size="sm" icon={<ArrowLeft className="size-4" aria-hidden />} onClick={() => go(target)}>
      Back
    </Button>
  );

  return (
    <div className="w-full max-w-md">
      <div className="mb-8 flex items-center lg:hidden">
        <Wordmark suffix="SHQ" className="text-3xl" />
      </div>
      <h2 className="text-3xl font-extrabold tracking-tight text-ink">{invitation ? "Join your team" : "Create your reseller account"}</h2>
      <p className="mt-2 text-sm text-muted">
        {invitation
          ? "Create your account with the email address the invitation was sent to."
          : "Set up your store, wallet and API keys. Verification and funding come after sign-up and may take longer."}
      </p>

      <div className="mt-6 space-y-5">
        <Progress steps={steps} current={step} />

        {authError && step === "details" ? <Notice tone="red">{googleErrors[authError] ?? "Google sign-up did not complete. Try again or use your email."}</Notice> : null}
        {notice ? <Notice tone={notice.startsWith("A new code") ? "green" : "amber"}>{notice}</Notice> : null}
        {error ? (
          <Notice tone="red">
            {errorMessage(error)}
            {errorCode === "email_in_use" ? (
              <>
                {" "}
                <AppLink href="/signin" className="font-semibold underline">
                  Sign in
                </AppLink>{" "}
                or{" "}
                <AppLink href={`/forgot-password?email=${encodeURIComponent(cleanEmail)}`} className="font-semibold underline">
                  reset your password
                </AppLink>
                .
              </>
            ) : null}
          </Notice>
        ) : null}

        {step === "details" ? (
          <>
            <form key="details" onSubmit={submitDetails} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="first-name">First name</Label>
                  <IconInput id="first-name" icon={User} autoComplete="given-name" required maxLength={50} autoFocus value={firstName} onChange={event => setFirstName(event.target.value)} />
                </div>
                <div>
                  <Label htmlFor="last-name">Last name</Label>
                  <IconInput id="last-name" icon={User} autoComplete="family-name" required maxLength={50} value={lastName} onChange={event => setLastName(event.target.value)} />
                </div>
              </div>
              <div>
                <Label htmlFor="email">Email</Label>
                <IconInput
                  id="email"
                  icon={Mail}
                  type="email"
                  autoComplete="email"
                  required
                  maxLength={254}
                  value={email}
                  onChange={event => setEmail(event.target.value)}
                  aria-invalid={failure(error)?.param === "email" || undefined}
                />
                {!invitation ? <p className="mt-1.5 text-xs text-muted">We will email you a 6-digit code to confirm it.</p> : null}
              </div>
              <Button type="submit" className="min-h-12 w-full text-base" loading={startState.isLoading} disabled={!firstName.trim() || !lastName.trim() || !email.trim()}>
                Continue
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
              {invitation ? "Use the Google account for the email the invitation was sent to." : "With Google, you name your business and choose its country next."}
            </p>
          </>
        ) : null}

        {step === "verify" ? (
          <form
            key="verify"
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              void submitCode(code);
            }}
            className="space-y-4"
          >
            <p className="text-sm text-muted">
              Enter the 6-digit code we sent to <span className="font-semibold break-all text-ink">{cleanEmail}</span>. It expires in 30 minutes.
            </p>
            <CodeInput label="Confirmation code" value={code} onChange={setCode} onComplete={submitCode} autoFocus disabled={verifyState.isLoading} invalid={Boolean(verifyState.error)} />
            <Button type="submit" className="min-h-12 w-full text-base" loading={verifyState.isLoading} disabled={code.length !== 6}>
              Confirm email
            </Button>
            <div className="flex flex-wrap items-center justify-between gap-2">
              {back("details")}
              <Button type="button" variant="ghost" size="sm" loading={startState.isLoading} onClick={resend}>
                Send a new code
              </Button>
            </div>
          </form>
        ) : null}

        {step === "business" ? (
          <form
            key="business"
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              go("password");
            }}
            className="space-y-4"
          >
            <Notice tone="green">
              <span className="break-all">{confirmed?.email}</span> is confirmed.
            </Notice>
            <div>
              <Label htmlFor="business">Business name</Label>
              <IconInput id="business" icon={Building2} autoComplete="organization" required minLength={2} maxLength={100} autoFocus value={business} onChange={event => setBusiness(event.target.value)} />
            </div>
            <div>
              <Label htmlFor="country">Business country</Label>
              {countries.isLoading ? (
                <Skeleton className="h-14 w-full" />
              ) : countries.error ? (
                <Notice tone="red">{errorMessage(countries.error, "Could not load countries. Reload the page to try again.")}</Notice>
              ) : (
                <Select id="country" required value={country} onChange={event => setCountry(event.target.value)} className="min-h-14 rounded-lg text-base">
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
            <Button type="submit" className="min-h-12 w-full text-base" disabled={business.trim().length < 2 || !country}>
              Continue
            </Button>
            {back("details")}
          </form>
        ) : null}

        {step === "password" ? (
          <form key="password" onSubmit={create} className="space-y-4">
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
                autoFocus
                value={password}
                onChange={event => setPassword(event.target.value)}
                aria-invalid={failure(error)?.param === "password" || undefined}
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
            <Button type="submit" className="min-h-12 w-full text-base" loading={signUpState.isLoading || signUpState.isSuccess} disabled={password.length < 10}>
              {invitation ? "Create account and join" : "Create account"}
            </Button>
            {back(invitation ? "details" : "business")}
          </form>
        ) : null}

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
