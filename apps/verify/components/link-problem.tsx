"use client";

import { useSyncExternalStore } from "react";
import { Link2Off, WifiOff } from "lucide-react";
import { brand } from "@/lib/brand";
import { returnHint } from "@/lib/return-hint";

const noop = () => () => undefined;

/**
 * No usable link: it expired, was used already, or the session ended. Links are made fresh where the check was started,
 * so the applicant goes back there. When the referring page was one of the brand's own sites, it is named and linked.
 */
export function LinkProblem({ unreachable }: { unreachable?: boolean }) {
  // The snapshot must be stable between calls (a string), or React re-renders forever; the hint is worked out from it.
  const referrer = useSyncExternalStore(noop, () => document.referrer, () => "");
  const back = returnHint(referrer);
  if (unreachable) {
    return (
      <section className="space-y-3 rounded-3xl border border-line bg-white p-6 text-center shadow-card">
        <WifiOff className="mx-auto size-10 text-muted" aria-hidden />
        <h1 className="text-xl font-extrabold">{`We could not reach ${brand.name}`}</h1>
        <p className="text-muted">Check your connection and reload this page.</p>
      </section>
    );
  }
  return (
    <section className="space-y-4 rounded-3xl border border-line bg-white p-6 text-center shadow-card">
      <Link2Off className="mx-auto size-10 text-muted" aria-hidden />
      <h1 className="text-xl font-extrabold">This link has expired</h1>
      <p className="text-muted">
        {`Links work once and for a short time. Go back to ${back?.name ?? (brand.key === "afrippa" ? `the ${brand.name} page you came from` : `the store or ${brand.name} page you came from`)} and start the identity check again.`}
      </p>
      {back ? (
        <a href={back.url} className="inline-flex min-h-12 items-center justify-center rounded-xl bg-navy-900 px-5 font-semibold text-white hover:bg-navy-800">
          {`Back to ${back.name}`}
        </a>
      ) : null}
    </section>
  );
}
