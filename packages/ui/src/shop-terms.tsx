"use client";

import { useEffect, useState } from "react";
import { appUrl } from "./site";

/** The BitoCard Shop terms' current version, from `GET /v1/classifieds/terms`. */
export type ShopTermsStatus = { version: string; path: string; accepted: boolean; previous_version: string | null };

/** The error code the API answers when posting or Safe pay needs the terms accepted first. */
export const shopTermsCode = "terms_not_accepted";

const dateOf = (version: string) => {
  const date = new Date(`${version}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? version : date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
};

/**
 * Asks for the BitoCard Shop terms to be accepted, shown where posting a listing or Safe pay was refused for it: the
 * version read from the API (`load`), a link to read it on the legals site, and "I accept", which records that version
 * (`accept`, the site's own server action) and then retries what was refused (`onAccepted`). Shared by bitocard.com's
 * Shop tab and shop.bitocard.com.
 */
export function ShopTermsAccept({
  load,
  accept,
  onAccepted,
}: {
  load: () => Promise<ShopTermsStatus | null>;
  accept: (version: string) => Promise<{ ok: boolean; message?: string }>;
  onAccepted: () => void;
}) {
  const [terms, setTerms] = useState<ShopTermsStatus | null>(null);
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
    <div role="alert" className="grid gap-2.5 rounded-2xl border border-slate-200 bg-white p-4 text-left text-sm text-slate-700">
      <strong className="text-[15px] text-navy-900">{terms?.previous_version ? "The BitoCard Shop terms have changed" : "Accept the BitoCard Shop terms"}</strong>
      <p>
        Before you post listings or use Safe pay, read and accept the{" "}
        <a href={appUrl("legals", terms?.path ?? "/documents/shop-terms")} target="_blank" rel="noopener" className="font-semibold text-navy-900 underline">
          BitoCard Shop terms
        </a>
        {terms ? ` (${dateOf(terms.version)})` : ""}. They cover what may be sold, Safe pay&apos;s fees, deadlines and disputes, and paying directly.
      </p>
      {failed ? <p className="font-semibold text-brand-700">{failed}</p> : null}
      <button
        type="button"
        disabled={!terms || busy}
        onClick={() => void agree()}
        className="h-11 justify-self-start rounded-full bg-navy-900 px-5 font-bold text-white hover:bg-navy-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? "Saving…" : "I accept the BitoCard Shop terms"}
      </button>
    </div>
  );
}
