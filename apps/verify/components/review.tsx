"use client";

import { createContext, use, useEffect, useMemo, useState, type ReactNode } from "react";
import { Loader2, ShieldAlert } from "lucide-react";
import { Brand } from "@bitocard/ui/brand";
import { Card, ErrorState, Notice, Select } from "@bitocard/admin-ui";
import type { KycReviewEligibility } from "@bitocard/api-client/kyc";
import type { Session } from "@bitocard/api-client/reseller";
import { ineligible, pickAccount, reviewRequest, type ReviewResult, shqBase, signInUrl } from "@/lib/review";

type Review = {
  session: Session;
  reseller: string;
  eligibility: KycReviewEligibility;
  request: <T>(path: string, options?: { method?: "GET" | "POST"; body?: unknown }) => Promise<ReviewResult<T>>;
};

const ReviewContext = createContext<Review | null>(null);

/** The signed-in reseller, the account in use and the request helper; only inside an eligible console. */
export function useReview() {
  const review = use(ReviewContext);
  if (!review) throw new Error("useReview outside ReviewShell");
  return review;
}

const accountKey = "bc_verify_reseller";
const remembered = () => {
  try {
    return window.localStorage.getItem(accountKey);
  } catch {
    return null;
  }
};
const remember = (id: string) => {
  try {
    window.localStorage.setItem(accountKey, id);
  } catch {
    // Private windows may refuse storage; the first account is used next time.
  }
};

type State =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "no_account" }
  | { phase: "ready"; session: Session; reseller: string; eligibility: KycReviewEligibility };

function Header({ session, reseller, onAccount }: { session?: Session; reseller?: string; onAccount: (id: string) => void }) {
  return (
    <header className="border-b border-line bg-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <span className="flex items-center gap-2 text-xl font-extrabold tracking-tight text-ink" aria-label="BitoCard Verify review">
          <span className="flex items-center gap-[0.3em]" aria-hidden="true">
            <Brand />
          </span>
          <span className="rounded-full bg-navy-100 px-2 py-0.5 text-xs font-bold text-navy-900">Review</span>
        </span>
        {session && session.memberships.length > 1 ? (
          <div className="w-64 max-w-full">
            <Select aria-label="Business" value={reseller} onChange={event => onAccount(event.target.value)}>
              {session.memberships.map(item => (
                <option key={item.reseller.id} value={item.reseller.id}>
                  {item.reseller.name}
                </option>
              ))}
            </Select>
          </div>
        ) : session && reseller ? (
          <span className="text-sm font-semibold text-muted">{session.memberships.find(item => item.reseller.id === reseller)?.reseller.name}</span>
        ) : null}
      </div>
    </header>
  );
}

/**
 * The reseller review console's frame: signs the person in at SHQ (and back), picks the business they act for, and asks
 * the API whether it may review. Only registered, KYB-verified, active businesses (owners and admins) see anything;
 * everyone else is told why, and no customer data is ever requested.
 */
export function ReviewShell({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ phase: "loading" });
  const [account, setAccount] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    const load = async (): Promise<State | null> => {
      const session = await reviewRequest<Session>("/v1/auth/session");
      if (!session.ok) {
        if (session.status === 401) {
          window.location.assign(signInUrl(shqBase(), window.location.href));
          return null;
        }
        return { phase: "error", message: session.message };
      }
      // Two-step sign-in not finished yet: SHQ's sign-in page asks for the code, then comes back.
      if (session.data.two_step?.pending) {
        window.location.assign(signInUrl(shqBase(), window.location.href));
        return null;
      }
      const reseller = pickAccount(session.data.memberships, account ?? remembered());
      if (!reseller) return { phase: "no_account" };
      const eligibility = await reviewRequest<KycReviewEligibility>("/v1/kyc/reviews/eligibility", { reseller });
      if (!eligibility.ok) return { phase: "error", message: eligibility.message };
      return { phase: "ready", session: session.data, reseller, eligibility: eligibility.data };
    };
    void load().then(next => {
      if (live && next) setState(next);
    });
    return () => {
      live = false;
    };
  }, [account, attempt]);

  const choose = (id: string) => {
    remember(id);
    setState({ phase: "loading" });
    setAccount(id);
  };

  const ready = state.phase === "ready" ? state : null;
  const blocked = ready ? ineligible(ready.eligibility) : null;
  // One value per account, so pages' effects that depend on `request` run once, not on every render.
  const review = useMemo<Review | null>(
    () => (ready ? { session: ready.session, reseller: ready.reseller, eligibility: ready.eligibility, request: (path, options) => reviewRequest(path, { ...options, reseller: ready.reseller }) } : null),
    [ready],
  );

  return (
    <div className="min-h-svh">
      <Header session={ready?.session} reseller={ready?.reseller} onAccount={choose} />
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6">
        {state.phase === "loading" ? (
          <p className="flex items-center justify-center gap-2 p-10 font-semibold text-muted" role="status">
            <Loader2 className="size-5 animate-spin" aria-hidden /> Loading…
          </p>
        ) : state.phase === "error" ? (
          <Card>
            <ErrorState message={state.message} onRetry={() => setAttempt(value => value + 1)} />
          </Card>
        ) : state.phase === "no_account" ? (
          <Notice tone="grey" title="No business on this account">
            You are signed in, but not part of a reseller business. Customers’ ID checks are reviewed by the business they buy from, or by BitoCard.
          </Notice>
        ) : blocked ? (
          <Card>
            <div className="space-y-3 p-6 text-center">
              <ShieldAlert className="mx-auto size-10 text-muted" aria-hidden />
              <h1 className="text-xl font-extrabold">{blocked.title}</h1>
              <p className="mx-auto max-w-prose text-muted">{blocked.text}</p>
            </div>
          </Card>
        ) : ready ? (
          <ReviewContext value={review}>{children}</ReviewContext>
        ) : null}
      </main>
    </div>
  );
}
