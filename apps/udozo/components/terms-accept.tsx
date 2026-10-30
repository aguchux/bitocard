"use client";

import { useEffect, useState } from "react";

/** The Udozo terms' current version, from `GET /v1/classifieds/terms`. */
export type TermsStatus = { version: string; path: string; accepted: boolean; previous_version: string | null };

/** The error code the API answers when posting or Safe pay needs the terms accepted first. */
export const termsCode = "terms_not_accepted";

const dateOf = (version: string) => {
  const date = new Date(`${version}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? version : date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
};

/**
 * Asks for Udozo's terms to be accepted, shown where posting a listing or Safe pay was refused for it: the version read
 * from the API (`load`), then "I accept", which records that version (`accept`, a server action) and retries what was
 * refused (`onAccepted`). Udozo's own legal documents are still to be published (docs/UDOZO_SPINOFF_PLAN.md, step 5);
 * until then nothing is linked, and never BitoCard's.
 */
export function TermsAccept({ load, accept, onAccepted }: { load: () => Promise<TermsStatus | null>; accept: (version: string) => Promise<{ ok: boolean; message?: string }>; onAccepted: () => void }) {
  const [terms, setTerms] = useState<TermsStatus | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void load().then(status => {
      if (!live) return;
      if (status) setTerms(status);
      else setFailed("The terms could not be loaded. Try again in a moment.");
    });
    return () => {
      live = false;
    };
  }, [load]);

  const agree = async () => {
    if (!terms) return;
    setBusy(true);
    setFailed(null);
    const result = await accept(terms.version);
    setBusy(false);
    if (result.ok) onAccepted();
    else setFailed(result.message ?? "That did not work. Try again.");
  };

  return (
    <div role="alert" className="grid gap-2.5 rounded-2xl border border-navy-200 bg-white p-4 text-left text-sm text-navy-700">
      <strong className="text-[15px] text-navy-900">{terms?.previous_version ? "Udozo's terms have changed" : "Accept Udozo's terms"}</strong>
      <p>
        Before you post listings or use Safe pay, accept Udozo&apos;s terms{terms ? ` (${dateOf(terms.version)})` : ""}. They cover what may be sold, Safe pay&apos;s fees, deadlines and disputes, and paying
        directly.
      </p>
      {failed ? <p className="font-semibold text-brand-700">{failed}</p> : null}
      <button
        type="button"
        disabled={!terms || busy}
        onClick={() => void agree()}
        className="h-11 justify-self-start rounded-full bg-navy-900 px-5 font-bold text-white hover:bg-navy-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? "Saving…" : "I accept Udozo's terms"}
      </button>
    </div>
  );
}
