"use client";

import { useState, useTransition } from "react";
import { Check, Copy, KeyRound, ShieldCheck } from "lucide-react";
import type { StoreVpn } from "@bitocard/api-client/storefront";
import { resetVpnPassword, type VpnSource } from "@/lib/vpn-actions";

/** Status colours follow the store's order states: active green, ended grey, stopped red, waiting blue or amber. */
const statuses: Record<StoreVpn["status"], { label: string; tone: string }> = {
  provisioning: { label: "Setting up", tone: "bg-blue-50 text-blue-800" },
  active: { label: "Active", tone: "bg-emerald-50 text-emerald-800" },
  expired: { label: "Ended", tone: "bg-slate-100 text-slate-700" },
  revoked: { label: "Stopped (refunded)", tone: "bg-pink-50 text-pink-800" },
  suspended: { label: "Suspended", tone: "bg-red-50 text-red-800" },
  failed: { label: "Not set up", tone: "bg-red-50 text-red-800" },
  needs_review: { label: "Needs support", tone: "bg-amber-50 text-amber-900" },
};

const date = (iso: string) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(iso));

export function CopyValue({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="min-w-0">
        <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">{label}</p>
        <p className="font-mono text-lg font-bold break-all">{value}</p>
      </div>
      <button
        type="button"
        aria-label={`Copy ${label.toLowerCase()}`}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2000);
          } catch {
            // Shown on screen to copy by hand.
          }
        }}
        className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl border border-slate-200 px-3 text-sm font-semibold hover:border-slate-300"
      >
        {copied ? <Check className="size-4 text-emerald-600" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

/**
 * The order's VPN access: whether it works, when it ends (it never renews), and a new password on request. A new
 * password signs out every device using the old one; it is shown here once and on the order from then on.
 */
export function VpnAccess({ source, vpn, store }: { source: VpnSource; vpn: StoreVpn; store: string }) {
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fresh, setFresh] = useState<{ username: string; password: string } | null>(null);
  const status = statuses[vpn.status];
  const active = vpn.status === "active";
  const ends = vpn.expires_at;

  const reset = () =>
    start(async () => {
      setError(null);
      const result = await resetVpnPassword(source);
      setConfirming(false);
      if (result.ok) setFresh({ username: result.username, password: result.password });
      else setError(result.error);
    });

  return (
    <section aria-labelledby="vpn-access" className="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="vpn-access" className="flex items-center gap-2 text-xl font-bold">
          <ShieldCheck className="size-5 text-brand-500" aria-hidden="true" /> VPN access
        </h2>
        <span className={`rounded-full px-3 py-1 text-sm font-semibold ${status.tone}`}>{status.label}</span>
      </div>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-slate-500">{active || vpn.status === "provisioning" ? "Access ends" : "Was due to end"}</dt>
          <dd className="font-semibold">{ends ? `${date(ends)} UTC` : "When it is set up"}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Devices</dt>
          <dd className="font-semibold">{`Up to ${vpn.devices} at once`}</dd>
        </div>
      </dl>
      <p className="mt-3 rounded-2xl bg-slate-50 p-3 text-sm text-slate-700">
        <strong>Does not renew automatically.</strong> Access stops on the date above. To keep using it, buy VPN access again from {store}.
      </p>
      {vpn.status === "needs_review" || vpn.status === "suspended" ? <p className="mt-3 text-sm text-slate-700">{`This access is paused while it is checked. Contact ${store} if you need help.`}</p> : null}

      {fresh ? (
        <div className="mt-4 space-y-3 rounded-2xl border border-emerald-200 bg-emerald-50/40 p-4" role="status">
          <p className="text-sm font-semibold text-emerald-900">Your password was changed. Sign in again on each device with:</p>
          <CopyValue label="Username" value={fresh.username} />
          <CopyValue label="New password" value={fresh.password} />
        </div>
      ) : null}

      {active ? (
        <div className="mt-4">
          {confirming ? (
            <div className="space-y-3 rounded-2xl border border-slate-200 p-4">
              <p className="text-sm text-slate-700">A new password signs out every device using the old one. Continue?</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={reset} disabled={pending} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-navy-900 px-4 font-semibold text-white hover:bg-navy-800 disabled:opacity-60">
                  <KeyRound className="size-4" aria-hidden="true" /> {pending ? "Changing…" : "Change password"}
                </button>
                <button type="button" onClick={() => setConfirming(false)} disabled={pending} className="inline-flex min-h-11 items-center rounded-xl border border-slate-200 px-4 font-semibold hover:border-slate-300">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirming(true)} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-4 font-semibold hover:border-slate-300">
              <KeyRound className="size-4" aria-hidden="true" /> Reset password
            </button>
          )}
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      ) : null}
    </section>
  );
}
