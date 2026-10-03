"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useDispatch } from "react-redux";
import { Building2, LogOut, MailCheck } from "lucide-react";
import { bitocardApi, setRequestContext } from "@bitocard/api-client";
import { type Membership, type Mode, type ResellerRole, type User, useResendEmailCodeMutation, useSessionQuery, useSignOutMutation, useVerifyEmailMutation } from "@bitocard/api-client/reseller";
import { Button, Card, CodeInput, ErrorState, errorMessage, Notice, Skeleton } from "@bitocard/admin-ui";
import { mainSiteUrl } from "./links";

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

/** Signed in, but not a member of any reseller account (for example an invitation not yet accepted). */
function NoAccount({ user }: { user: User }) {
  const [signOut, signingOut] = useSignOut();
  return (
    <Centered>
      <Card className="w-full max-w-md space-y-4 p-6 sm:p-8">
        <span className="grid size-12 place-items-center rounded-xl bg-brand-50 text-brand-600">
          <Building2 className="size-6" aria-hidden />
        </span>
        <h1 className="text-2xl font-extrabold tracking-tight text-ink">No reseller account yet</h1>
        <p className="text-sm text-muted">
          {user.email} is not part of a reseller account. Create one on BitoCard, or open the invitation a reseller sent you while signed in with this email.
        </p>
        <div className="flex flex-wrap gap-2">
          <a href={mainSiteUrl("/signup")} className="inline-flex min-h-11 items-center rounded-lg bg-brand-500 px-4 text-sm font-semibold text-white hover:bg-brand-600">
            Create a reseller account
          </a>
          <Button variant="secondary" loading={signingOut} onClick={signOut}>
            Sign out
          </Button>
        </div>
      </Card>
    </Centered>
  );
}

/**
 * Renders its children only for a signed-in person with a confirmed email and a reseller account; otherwise sign-in,
 * email confirmation or the "no account" screen. Chooses the reseller account (remembered in this browser) and live or
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
  if (!value) return <NoAccount user={data.user} />;
  return <ResellerContext.Provider value={value}>{children}</ResellerContext.Provider>;
}
