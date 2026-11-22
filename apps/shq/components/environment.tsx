"use client";

import type { ReactNode } from "react";
import { ArrowRight, FlaskConical, Radio, ShieldAlert } from "lucide-react";
import { cn } from "@bitocard/admin-ui";
import { AppLink } from "@bitocard/admin-ui/shell";
import type { DeveloperOverview, Mode } from "@bitocard/api-client/reseller";
import { useReseller } from "./reseller";

export const apiUrl = "https://api.bitocard.com";

/** What each environment is, in a reseller's words. */
export const environments: Record<Mode, { name: string; short: string; prefix: string; lead: string }> = {
  live: { name: "Live", short: "Live", prefix: "bc_live_", lead: "Real money, real suppliers and real customers. Orders are fulfilled and wallets are charged." },
  test: { name: "Sandbox", short: "Sandbox", prefix: "bc_test_", lead: "Test money and simulated orders: every product is there, nothing reaches a supplier or a bank." },
};

type LiveReadiness = DeveloperOverview["live"] | { ready: false; reason: "pending" };

/** Why live is not open yet, in words, with where to go next. */
export function liveBlocker(live: LiveReadiness | undefined): { text: string; href?: string; action?: string } | null {
  if (!live || live.ready) return null;
  if (live.reason === "pending") return { text: "Going live needs your passed identity check and BitoCard’s activation. The sandbox needs neither.", href: "/settings/verification", action: "Your identity check" };
  if (live.reason === "identity_check") return { text: "Going live needs your identity check, then BitoCard activates the account.", href: "/settings/verification", action: "Start the identity check" };
  if (live.reason === "awaiting_activation") return { text: "Your identity check has passed: BitoCard is activating the account. You can keep testing in the sandbox." };
  return { text: "This account is suspended, so nothing can go live. Contact BitoCard support.", href: "/support/new", action: "Contact support" };
}

/**
 * Live or sandbox as a two-part switch: the current environment filled in (green live, amber sandbox), the other one
 * a button. Every page's data and actions follow it.
 */
export function ModeToggle({ size = "sm", className }: { size?: "sm" | "lg"; className?: string }) {
  const { mode, setMode } = useReseller();
  const large = size === "lg";
  const option = (value: Mode, icon: ReactNode) => {
    const selected = mode === value;
    return (
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        onClick={() => !selected && setMode(value)}
        className={cn(
          "inline-flex items-center justify-center gap-1.5 rounded-full font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2",
          large ? "min-h-11 px-5 text-sm" : "min-h-8 px-3 text-xs",
          selected
            ? value === "live"
              ? "bg-emerald-600 text-white shadow-sm"
              : "bg-amber-400 text-amber-950 shadow-sm"
            : "text-muted hover:bg-white hover:text-ink",
        )}
      >
        {icon}
        {environments[value].short}
      </button>
    );
  };
  return (
    <div role="radiogroup" aria-label="Environment" className={cn("inline-flex shrink-0 items-center gap-0.5 rounded-full border border-line bg-canvas p-0.5", className)}>
      {option("live", <span aria-hidden className={cn("rounded-full", large ? "size-2.5" : "size-2", mode === "live" ? "animate-pulse bg-white" : "bg-emerald-500")} />)}
      {option("test", <FlaskConical aria-hidden className={large ? "size-4" : "size-3.5"} />)}
    </div>
  );
}

/**
 * The environment at the top of the Developers pages: where calls go, which keys work, and a big button to switch.
 * Sandbox is amber, live green, so nobody mistakes one for the other.
 */
export function EnvironmentPanel({ live, children }: { live?: DeveloperOverview["live"]; children?: ReactNode }) {
  const { mode, setMode, membership } = useReseller();
  const sandbox = mode === "test";
  const other: Mode = sandbox ? "live" : "test";
  // The overview knows why live is closed; elsewhere the account's status says whether it is.
  const status = membership.reseller.status;
  const readiness: LiveReadiness = live ?? (status === "active" ? { ready: true, reason: "verified" } : { ready: false, reason: status === "suspended" ? "suspended" : "pending" });
  const blocker = sandbox ? liveBlocker(readiness) : null;
  return (
    <section
      aria-label={`${environments[mode].name} environment`}
      className={cn(
        "relative overflow-hidden rounded-2xl p-5 text-white shadow-card sm:p-6",
        sandbox ? "bg-gradient-to-br from-amber-500 via-orange-500 to-rose-500" : "bg-gradient-to-br from-emerald-600 via-teal-600 to-cyan-700",
      )}
    >
      <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 size-56 rounded-full bg-white/10" />
      <div aria-hidden className="pointer-events-none absolute -bottom-24 right-24 size-56 rounded-full bg-white/10" />
      <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <span aria-hidden className="grid size-12 shrink-0 place-items-center rounded-2xl bg-white/20 ring-1 ring-white/30">
            {sandbox ? <FlaskConical className="size-6" /> : <Radio className="size-6" />}
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/80">Environment</p>
            <h2 className="text-xl font-extrabold tracking-tight sm:text-2xl">{sandbox ? "You are in the sandbox" : "You are live"}</h2>
            <p className="mt-1 max-w-xl text-sm text-white/90">{environments[mode].lead}</p>
            <dl className="mt-3 flex flex-wrap gap-2 text-xs">
              <div className="rounded-full bg-black/15 px-3 py-1">
                <dt className="sr-only">Keys</dt>
                <dd>
                  Keys start <code className="font-mono font-semibold">{environments[mode].prefix}</code>
                </dd>
              </div>
              <div className="min-w-0 rounded-full bg-black/15 px-3 py-1">
                <dt className="sr-only">Address</dt>
                <dd className="truncate">
                  <code className="font-mono">{apiUrl}</code>
                </dd>
              </div>
            </dl>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-stretch gap-2 sm:flex-row sm:items-center lg:flex-col lg:items-end">
          <button
            type="button"
            onClick={() => setMode(other)}
            className={cn(
              "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-white px-5 text-sm font-bold shadow-lg transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white",
              sandbox ? "text-emerald-700" : "text-orange-700",
            )}
          >
            {sandbox ? <Radio className="size-4" aria-hidden /> : <FlaskConical className="size-4" aria-hidden />}
            {sandbox ? "Go live" : "Switch to sandbox"}
            <ArrowRight className="size-4" aria-hidden />
          </button>
          {children}
        </div>
      </div>
      {blocker ? (
        <p className="relative mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl bg-black/20 px-4 py-2.5 text-sm">
          <ShieldAlert className="size-4 shrink-0" aria-hidden />
          <span>{blocker.text}</span>
          {blocker.href ? (
            <AppLink href={blocker.href} className="font-semibold underline underline-offset-2">
              {blocker.action}
            </AppLink>
          ) : null}
        </p>
      ) : null}
    </section>
  );
}
