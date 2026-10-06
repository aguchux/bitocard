"use client";

import { FlaskConical, LogIn, Radio } from "lucide-react";
import { shqSignInUrl, useTryIt } from "./try-it-context";

/** The header's "Try it" state: sign in, or the account in use and Sandbox/Live. */
export function AccountControls() {
  const { status, session, membership, chooseReseller, mode, setMode } = useTryIt();

  if (status === "checking") return <span className="h-9 w-28 animate-pulse rounded-lg bg-slate-100" aria-hidden />;
  if (status !== "signed_in" || !session || !membership) {
    return (
      <button
        type="button"
        onClick={() => window.location.assign(shqSignInUrl())}
        className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-[#070f4c] px-3 text-sm font-semibold whitespace-nowrap text-white hover:bg-[#121a6b]"
        title="Sign in with your SHQ account to try the API"
      >
        <LogIn className="size-4" aria-hidden />
        <span className="hidden sm:inline">Sign in to try it</span>
        <span className="sm:hidden">Sign in</span>
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {session.memberships.length > 1 ? (
        <label className="hidden md:block">
          <span className="sr-only">Reseller account</span>
          <select
            value={membership.reseller.id}
            onChange={event => chooseReseller(event.target.value)}
            className="min-h-9 max-w-44 truncate rounded-lg border border-slate-200 bg-white px-2 text-sm text-[#070f4c]"
          >
            {session.memberships.map(item => (
              <option key={item.reseller.id} value={item.reseller.id}>
                {item.reseller.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <span className="hidden max-w-40 truncate text-sm text-slate-600 md:inline" title={session.user.email}>
          {membership.reseller.name}
        </span>
      )}
      <div role="radiogroup" aria-label="Try it mode" className="flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-sm font-semibold">
        <button
          type="button"
          role="radio"
          aria-checked={mode === "test"}
          onClick={() => setMode("test")}
          className={`inline-flex min-h-8 items-center gap-1.5 rounded-md px-2.5 ${mode === "test" ? "bg-white text-[#070f4c] shadow-sm" : "text-slate-500 hover:text-[#070f4c]"}`}
        >
          <FlaskConical className="size-4" aria-hidden />
          Sandbox
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={mode === "live"}
          onClick={() => setMode("live")}
          className={`inline-flex min-h-8 items-center gap-1.5 rounded-md px-2.5 ${mode === "live" ? "bg-red-600 text-white shadow-sm" : "text-slate-500 hover:text-red-700"}`}
        >
          <Radio className="size-4" aria-hidden />
          Live
        </button>
      </div>
    </div>
  );
}

/** A full-width warning under the header while live mode is on. */
export function LiveBanner() {
  const { status, mode, membership, readOnly, setReadOnly } = useTryIt();
  if (status !== "signed_in" || mode !== "live" || !membership) return null;
  return (
    <div role="status" className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800 sm:px-6">
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-4 gap-y-1">
        <p>
          <span className="font-semibold">Live mode:</span> Try it calls {membership.reseller.name}&apos;s real account. Orders, top-ups and payouts are real.
        </p>
        <label className="ml-auto inline-flex items-center gap-2 font-semibold">
          <input type="checkbox" checked={readOnly} onChange={event => setReadOnly(event.target.checked)} className="size-4 accent-red-600" />
          Read-only (GET only)
        </label>
      </div>
    </div>
  );
}
