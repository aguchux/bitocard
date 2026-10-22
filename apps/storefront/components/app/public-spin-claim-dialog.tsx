"use client";

import { useEffect, useRef, useState } from "react";
import { Gift, Loader2, X } from "lucide-react";
import { formatPrice, type StorePublicSpinClaim } from "@bitocard/api-client/storefront";
import { claimPublicSpin, dismissPublicSpinClaim } from "@/lib/spin-actions";

/** First-login handoff for wins made on /spin while signed out. */
export function PublicSpinClaimDialog({ initial }: { initial: StorePublicSpinClaim | null }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [claim, setClaim] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (initial && initial.status !== "claimed") dialog.current?.showModal();
  }, [initial]);
  if (!claim || claim.status === "claimed") return null;

  const close = () => {
    dialog.current?.close();
    void dismissPublicSpinClaim();
    setClaim(null);
  };

  async function move(currency: string) {
    setBusy(currency);
    setError(null);
    const result = await claimPublicSpin(currency);
    setBusy(null);
    if (result.ok) setClaim(result.data);
    else setError(result.message);
  }

  return (
    <dialog ref={dialog} aria-labelledby="saved-spin-title" className="fixed inset-0 z-50 m-auto w-[min(92vw,34rem)] rounded-3xl bg-white p-0 text-navy-900 shadow-2xl backdrop:bg-navy-950/80">
      <div className="p-6 sm:p-8">
        <div className="flex items-start justify-between gap-4">
          <span className="grid size-12 place-items-center rounded-2xl bg-amber-100 text-amber-700"><Gift className="size-6" aria-hidden="true" /></span>
          <button type="button" onClick={close} className="grid size-11 place-items-center rounded-full bg-slate-100 hover:bg-slate-200" aria-label="Close"><X className="size-5" aria-hidden="true" /></button>
        </div>
        {claim.status === "active" ? (
          <>
            <h2 id="saved-spin-title" className="font-display mt-5 text-3xl font-black">Add your saved wins</h2>
            <p className="mt-2 text-slate-600">Welcome. Your {claim.spins} visitor spins won ${Number(claim.usd ?? 0).toFixed(2)}. Choose where to add it; this credit can be spent in the store and cannot be withdrawn.</p>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {(claim.currencies ?? []).map(option => (
                <button key={option.currency} type="button" disabled={busy !== null} onClick={() => move(option.currency)} className="min-h-14 rounded-2xl bg-navy-900 px-4 font-bold text-white hover:bg-navy-800 disabled:opacity-60">
                  {busy === option.currency ? <Loader2 className="mx-auto size-5 animate-spin" aria-label="Adding" /> : `Add ${formatPrice(option.amount, option.currency)}`}
                </button>
              ))}
            </div>
            {error ? <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p> : null}
          </>
        ) : (
          <>
            <h2 id="saved-spin-title" className="font-display mt-5 text-3xl font-black">Saved spins updated</h2>
            <p className="mt-2 text-slate-600">{claim.message ?? "This visitor claim is no longer available."}</p>
            <button type="button" onClick={close} className="mt-6 min-h-12 rounded-xl bg-navy-900 px-5 font-bold text-white hover:bg-navy-800">Continue</button>
          </>
        )}
      </div>
    </dialog>
  );
}
