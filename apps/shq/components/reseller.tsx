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
  usePublicCountriesQuery,
  useResendEmailCodeMutation,
  useSessionQuery,
  useSignOutMutation,
  useVerifyEmailMutation,
} from "@bitocard/api-client/reseller";
import { Button, Card, CodeInput, ErrorState, errorMessage, Field, Input, Notice, Select, Skeleton } from "@bitocard/admin-ui";

const resellerKey = "shq-reseller";
const modeKey = "shq-mode";

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

/**
 * Onboarding: signed in, but not a member of any reseller account. Google sign-ups land here first; so do people with
 * an invitation not yet accepted, or removed from a team. They open their own reseller account here.
 */
function Onboarding({ user }: { user: User }) {
  const [signOut, signingOut] = useSignOut();
  const countries = usePublicCountriesQuery();
  const open = countries.data?.data.filter(item => item.reseller_signup) ?? [];
  const [business, setBusiness] = useState("");
  const [country, setCountry] = useState("");
  const [create, state] = useCreateResellerAccountMutation();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    // The session refetches and the gate opens the new account.
    void create({ business_name: business.trim(), country }).unwrap().catch(() => null);
  };
  return (
    <Centered>
      <Card className="w-full max-w-md space-y-4 p-6 sm:p-8">
        <span className="grid size-12 place-items-center rounded-xl bg-brand-50 text-brand-600">
          <Building2 className="size-6" aria-hidden />
        </span>
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-ink">Set up your business</h1>
          <p className="mt-1 text-sm text-muted">
            Welcome, {user.name.trim().split(/\s+/)[0]}. Name your business and choose its country to open your reseller account.
          </p>
        </div>
        {state.error ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
        <form onSubmit={submit} className="space-y-4">
          <Field label="Business name" htmlFor="new-business">
            <Input id="new-business" autoComplete="organization" required minLength={2} maxLength={100} value={business} onChange={event => setBusiness(event.target.value)} />
          </Field>
          <Field label="Business country" htmlFor="new-country" hint="You sell in its currency.">
            {countries.isLoading ? (
              <Skeleton className="h-11 w-full" />
            ) : (
              <Select id="new-country" required value={country} onChange={event => setCountry(event.target.value)}>
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
          <div className="flex flex-wrap gap-2">
            <Button type="submit" loading={state.isLoading} disabled={!country || business.trim().length < 2}>
              Open my reseller account
            </Button>
            <Button type="button" variant="secondary" loading={signingOut} onClick={signOut}>
              Sign out
            </Button>
          </div>
        </form>
        <p className="text-xs text-muted">
          Joining a reseller&apos;s team instead? Open the invitation they sent to <span className="break-all">{user.email}</span>.
        </p>
      </Card>
    </Centered>
  );
}

/**
 * Renders its children only for a signed-in person with a confirmed email and a reseller account; otherwise sign-in,
 * email confirmation or onboarding. Chooses the reseller account (remembered in this browser) and live or
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
  if (error || !data) return <ErrorState message={errorMessage(error, "Could not check your session.")} onRetry={refetch} />;
  if (!data.user.email_verified) return <VerifyEmail user={data.user} />;
  if (!value) return <Onboarding user={data.user} />;
  return <ResellerContext.Provider value={value}>{children}</ResellerContext.Provider>;
}
