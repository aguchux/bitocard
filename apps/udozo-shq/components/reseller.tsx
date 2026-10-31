"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useDispatch } from "react-redux";
import { Building2, LogOut, MailCheck } from "lucide-react";
import { bitocardApi, setRequestContext } from "@bitocard/api-client";
import {
  type Membership,
  type Mode,
  type ResellerRole,
  type User,
  useCreateResellerAccountMutation,
  useOnboardingSignupTokenMutation,
  usePublicCountriesQuery,
  useResendEmailCodeMutation,
  useSessionQuery,
  useSignOutMutation,
  useStartSignupPhoneMutation,
  useUpdateProfileMutation,
  useVerifyEmailMutation,
  useVerifySignupPhoneMutation,
} from "@bitocard/api-client/reseller";
import { Button, Card, CodeInput, ErrorState, errorMessage, Field, Input, Notice, Select, Skeleton } from "@bitocard/admin-ui";
import { PhoneInput } from "@bitocard/ui/phone-input";
import { TwoStepSignIn } from "./two-step";

const resellerKey = "udozo-shq-reseller";
const modeKey = "udozo-shq-mode";

export type ResellerContextValue = {
  user: User;
  membership: Membership;
  memberships: Membership[];
  mode: Mode;
  setMode: (mode: Mode) => void;
  switchAccount: (resellerId: string) => void;
};

const ResellerContext = createContext<ResellerContextValue | null>(null);

/** The signed-in person, the reseller account the dashboard acts for, and live or sandbox mode. Only inside ResellerGate. */
export function useReseller() {
  const value = useContext(ResellerContext);
  if (!value) throw new Error("useReseller must be used inside <ResellerGate>");
  return value;
}

/** Owners can do everything; other members need one of the roles. Mirrors the API's checks (the API decides). */
export const can = (membership: Membership | null | undefined, ...roles: ResellerRole[]) => Boolean(membership && (membership.role === "owner" || roles.includes(membership.role)));

const read = (key: string) => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string) => {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* not remembered */
  }
};

/** Sends the browser to sign-in, remembering where to come back to. */
export function goToSignIn() {
  const next = `${window.location.pathname}${window.location.search}`;
  // A full page load, so nothing cached from an expired session survives.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign(`/signin${next && next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}`);
}

/** Signs out and reloads, so the next person never sees this one's data. */
export function useSignOut() {
  const [signOut, state] = useSignOutMutation();
  const run = useCallback(async () => {
    await signOut().unwrap().catch(() => undefined);
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/signin");
  }, [signOut]);
  return [run, state.isLoading] as const;
}

function Centered({ children }: { children: ReactNode }) {
  return <main className="flex min-h-svh items-center justify-center bg-canvas px-4 py-10">{children}</main>;
}

/** Signed in with a password (or Google) but not yet with the second step: the code, or setting a method up. */
function TwoStepStep() {
  const [signOut, signingOut] = useSignOut();
  return (
    <Centered>
      <Card className="w-full max-w-md p-6 sm:p-8">
        {/* Finishing refetches the session, and the gate opens. */}
        <TwoStepSignIn onDone={() => undefined} onSignOut={signOut} signingOut={signingOut} />
      </Card>
    </Centered>
  );
}

/** A new account confirms its email before anything else (the code was emailed at sign-up). */
function VerifyEmail({ user }: { user: User }) {
  const [code, setCode] = useState("");
  const [verify, verifyState] = useVerifyEmailMutation();
  const [resend, resendState] = useResendEmailCodeMutation();
  const [signOut, signingOut] = useSignOut();
  const submit = async (value: string) => {
    if (verifyState.isLoading) return;
    const done = await verify({ code: value }).unwrap().catch(() => null);
    if (!done) setCode("");
  };
  return (
    <Centered>
      <Card className="w-full max-w-md space-y-5 p-6 sm:p-8">
        <span className="grid size-12 place-items-center rounded-xl bg-brand-50 text-brand-600">
          <MailCheck className="size-6" aria-hidden />
        </span>
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-ink">Confirm your email</h1>
          <p className="mt-1 text-sm text-muted">
            Enter the 6-digit code we sent to <span className="font-semibold text-ink">{user.email}</span>.
          </p>
        </div>
        {verifyState.error ? <Notice tone="red">{errorMessage(verifyState.error)}</Notice> : null}
        {resendState.isSuccess ? <Notice tone="green">A new code is on its way.</Notice> : null}
        {resendState.error ? <Notice tone="red">{errorMessage(resendState.error)}</Notice> : null}
        <form
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            void submit(code);
          }}
          className="space-y-4"
        >
          <CodeInput label="Confirmation code" value={code} onChange={setCode} onComplete={submit} autoFocus disabled={verifyState.isLoading} invalid={Boolean(verifyState.error)} />
          <Button type="submit" className="w-full" loading={verifyState.isLoading} disabled={code.length !== 6}>
            Confirm email
          </Button>
        </form>
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <Button variant="ghost" size="sm" loading={resendState.isLoading} onClick={() => resend()}>
            Send a new code
          </Button>
          <Button variant="ghost" size="sm" icon={<LogOut className="size-4" aria-hidden />} loading={signingOut} onClick={signOut}>
            Sign out
          </Button>
        </div>
      </Card>
    </Centered>
  );
}

type ApiFailure = { code?: string } | undefined;
const failureCode = (error: unknown) => (error && typeof error === "object" ? (error as ApiFailure)?.code : undefined);

/**
 * Onboarding: signed in, but not a member of any reseller account. Google sign-ups land here first; so do people with
 * an invitation not yet accepted, or removed from a team. They open their own reseller account here, in two steps as
 * email sign-up does: their first and last name (Google's to check), the business, its country and their mobile; then
 * the code texted to the mobile, which becomes their sign-in number. Where the country cannot text yet, the account
 * opens with the number kept for Udozo's team only.
 */
function Onboarding({ user }: { user: User }) {
  const [signOut, signingOut] = useSignOut();
  const countries = usePublicCountriesQuery();
  const open = countries.data?.data.filter(item => item.reseller_signup) ?? [];
  const [firstName, setFirstName] = useState(user.first_name ?? user.name);
  const [lastName, setLastName] = useState(user.last_name ?? "");
  const [business, setBusiness] = useState("");
  const [country, setCountry] = useState("");
  // The owner's mobile number in E.164 (null until valid for the country).
  const [phone, setPhone] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [texted, setTexted] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [saveName, nameState] = useUpdateProfileMutation();
  const [issue, issueState] = useOnboardingSignupTokenMutation();
  const [startPhone, startState] = useStartSignupPhoneMutation();
  const [verifyPhone, verifyState] = useVerifySignupPhoneMutation();
  const [create, state] = useCreateResellerAccountMutation();
  const busy = nameState.isLoading || issueState.isLoading || startState.isLoading || verifyState.isLoading || state.isLoading;
  const error = nameState.error ?? issueState.error ?? (failureCode(startState.error) === "phone_verification_unavailable" ? undefined : startState.error) ?? verifyState.error ?? state.error;

  // The session refetches and the gate opens the new account.
  const openAccount = (signupToken: string | null) =>
    create({ business_name: business.trim(), country, ...(phone ? { phone } : {}), ...(signupToken ? { signup_token: signupToken } : {}) })
      .unwrap()
      .catch(() => null);

  async function sendCode(signupToken: string) {
    if (!phone) return;
    const sent = await startPhone({ email: user.email, signup_token: signupToken, country, phone })
      .unwrap()
      .then(() => true)
      .catch((problem: unknown) => failureCode(problem) ?? "failed");
    if (sent === true) {
      setTexted(phone);
      setCode("");
    } else if (sent === "phone_verification_unavailable") {
      // Nothing to text yet in this country: the number is kept unconfirmed, as at sign-up.
      await openAccount(null);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setNotice(null);
    const first = firstName.trim();
    const last = lastName.trim();
    if (!user.name_confirmed || first !== user.first_name || last !== (user.last_name ?? "")) {
      if (!(await saveName({ first_name: first, last_name: last }).unwrap().catch(() => null))) return;
    }
    const issued = token ?? (await issue().unwrap().catch(() => null))?.signup_token ?? null;
    if (!issued) return;
    setToken(issued);
    await sendCode(issued);
  }

  async function submitCode(value: string) {
    if (verifyState.isLoading || value.length !== 6 || !token) return;
    const done = await verifyPhone({ email: user.email, signup_token: token, code: value })
      .unwrap()
      .catch(() => null);
    if (!done) return setCode("");
    await openAccount(token);
  }

  if (texted) {
    return (
      <Centered>
        <Card className="w-full max-w-md space-y-4 p-6 sm:p-8">
          <div>
            <p className="text-xs font-semibold tracking-wide text-brand-600 uppercase">Step 2 of 2</p>
            <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-ink">Confirm your mobile</h1>
            <p className="mt-1 text-sm text-muted">We texted a 6-digit code to {texted}. It becomes your sign-in number.</p>
          </div>
          {notice ? <Notice tone="green">{notice}</Notice> : null}
          {error ? <Notice tone="red">{errorMessage(error)}</Notice> : null}
          <CodeInput label="6-digit code" value={code} onChange={setCode} onComplete={value => void submitCode(value)} autoFocus disabled={busy} invalid={Boolean(verifyState.error)} />
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="ghost" disabled={busy} onClick={() => token && void sendCode(token).then(() => setNotice("A new code is on its way."))}>
              Send me a new code
            </Button>
            <Button type="button" variant="ghost" disabled={busy} onClick={() => (setTexted(null), setCode(""))}>
              Change the number
            </Button>
          </div>
        </Card>
      </Centered>
    );
  }

  return (
    <Centered>
      <Card className="w-full max-w-md space-y-4 p-6 sm:p-8">
        <span className="grid size-12 place-items-center rounded-xl bg-brand-50 text-brand-600">
          <Building2 className="size-6" aria-hidden />
        </span>
        <div>
          <p className="text-xs font-semibold tracking-wide text-brand-600 uppercase">Step 1 of 2</p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-ink">Set up your business</h1>
          <p className="mt-1 text-sm text-muted">
            Welcome, {firstName.trim() || user.name.trim().split(/\s+/)[0]}. Check your name, name your business, choose its country and give us your mobile number to open your Seller HQ account.
          </p>
        </div>
        {error ? <Notice tone="red">{errorMessage(error)}</Notice> : null}
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="First name" htmlFor="new-first-name">
              <Input id="new-first-name" autoComplete="given-name" required maxLength={60} value={firstName} onChange={event => setFirstName(event.target.value)} />
            </Field>
            <Field label="Last name" htmlFor="new-last-name">
              <Input id="new-last-name" autoComplete="family-name" required maxLength={60} value={lastName} onChange={event => setLastName(event.target.value)} />
            </Field>
          </div>
          <p className="-mt-2 text-xs text-muted">As they are on your ID: your identity check is matched against them.</p>
          <Field label="Business name" htmlFor="new-business">
            <Input id="new-business" autoComplete="organization" required minLength={2} maxLength={100} value={business} onChange={event => setBusiness(event.target.value)} />
          </Field>
          <Field label="Business country" htmlFor="new-country" hint="You sell in its currency.">
            {countries.isLoading ? (
              <Skeleton className="h-11 w-full" />
            ) : (
              <Select
                id="new-country"
                required
                value={country}
                onChange={event => {
                  setCountry(event.target.value);
                  // A number is checked against its country, so a new country starts it again.
                  setPhone(null);
                  setTexted(null);
                }}
              >
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
          </Field>
          {country ? (
            <div>
              <PhoneInput
                key={country}
                country={country}
                label="Your mobile number"
                onChange={setPhone}
                required
                className="text-ink"
                inputClassName="min-h-11 border border-line bg-white px-3 text-sm text-ink focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none aria-[invalid=true]:border-red-400"
                errorClassName="text-red-700"
              />
              <p className="mt-1.5 text-xs text-muted">We text it a 6-digit code to confirm it. It becomes your sign-in number.</p>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" loading={busy} disabled={!firstName.trim() || !lastName.trim() || !country || business.trim().length < 2 || !phone}>
              Continue
            </Button>
            <Button type="button" variant="secondary" loading={signingOut} onClick={signOut}>
              Sign out
            </Button>
          </div>
        </form>
        <p className="text-xs text-muted">
          Joining a seller&apos;s team instead? Open the invitation they sent to <span className="break-all">{user.email}</span>.
        </p>
      </Card>
    </Centered>
  );
}

/**
 * Renders its children only for a signed-in person who has finished two-step sign-in (where it is on), with a confirmed
 * email and a reseller account; otherwise sign-in, the two-step code, email confirmation or onboarding. Chooses the reseller account (remembered in this browser) and live or
 * sandbox mode, and sends both with every API request.
 */
export function ResellerGate({ children }: { children: ReactNode }) {
  const dispatch = useDispatch();
  const { data, error, isLoading, refetch } = useSessionQuery();
  const unauthenticated = error && "status" in error && error.status === 401;
  const [stored, setStored] = useState<{ reseller: string | null; mode: Mode } | null>(null);

  useEffect(() => {
    if (unauthenticated) goToSignIn();
  }, [unauthenticated]);

  useEffect(() => {
    // A link from a push notification names its account and mode: remember them, then tidy the address.
    const params = new URLSearchParams(window.location.search);
    const linked = params.get("account");
    if (linked) write(resellerKey, linked);
    const linkedMode = params.get("mode");
    if (linkedMode === "test" || linkedMode === "live") write(modeKey, linkedMode);
    if (linked || params.has("mode")) {
      params.delete("account");
      params.delete("mode");
      const search = params.toString();
      window.history.replaceState(null, "", `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`);
    }
    // Read the stored choices once mounted (never during render, so server and client markup match).
    const mode: Mode = read(modeKey) === "test" ? "test" : "live";
    setRequestContext({ mode });
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStored({ reseller: read(resellerKey), mode });
  }, []);

  const memberships = useMemo(() => data?.memberships ?? [], [data]);
  const membership = memberships.find(item => item.reseller.id === stored?.reseller) ?? memberships[0];
  // Set before the children render, so their first requests already act for this account.
  if (membership) setRequestContext({ reseller: membership.reseller.id });

  const setMode = useCallback(
    (mode: Mode) => {
      write(modeKey, mode);
      setRequestContext({ mode });
      setStored(current => ({ reseller: current?.reseller ?? null, mode }));
      // Everything cached was for the other mode.
      dispatch(bitocardApi.util.resetApiState());
    },
    [dispatch],
  );
  const switchAccount = useCallback((resellerId: string) => {
    write(resellerKey, resellerId);
    // A full page load, so nothing cached for the other account survives.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/");
  }, []);

  const value = useMemo<ResellerContextValue | null>(
    () => (data && membership && stored ? { user: data.user, membership, memberships, mode: stored.mode, setMode, switchAccount } : null),
    [data, membership, memberships, stored, setMode, switchAccount],
  );

  if (isLoading || unauthenticated || !stored) {
    return (
      <div className="flex min-h-svh items-center justify-center p-8" aria-busy="true" aria-label="Checking your session">
        <Skeleton className="h-10 w-48" />
      </div>
    );
  }
  // A failed background refresh keeps the app on screen (and anything typed into it); only a first failure blocks it.
  if (!data) return <ErrorState message={errorMessage(error, "Could not check your session.")} onRetry={refetch} />;
  if (data.two_step?.pending) return <TwoStepStep />;
  if (!data.user.email_verified) return <VerifyEmail user={data.user} />;
  if (!value) return <Onboarding user={data.user} />;
  return <ResellerContext.Provider value={value}>{children}</ResellerContext.Provider>;
}
