"use client";

import { useId, useState } from "react";
import { Flag } from "lucide-react";
import { type ShopStoreReportReason, storeReportReasonLabels } from "@bitocard/api-client/classifieds";
import { reportStore } from "@/lib/purchase-actions";
import { reportResellerStore } from "@/lib/shop-actions";

type Target =
  | { kind: "order"; orderId: string; storeName: string }
  | { kind: "reseller"; relationshipId: string; stores: Array<{ id: string; name: string }> };

const reasons = Object.keys(storeReportReasonLabels) as ShopStoreReportReason[];

/**
 * Reporting a Resale shop to Udozo (B2B reselling, stage 5): a buyer from their resale order, a supplier from My
 * Resellers. Udozo reviews it; an upheld report counts against the reseller. One open report per store.
 */
export function ReportStore({ target }: { target: Target }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [storeId, setStoreId] = useState(target.kind === "reseller" ? (target.stores[0]?.id ?? "") : "");
  const [reason, setReason] = useState<ShopStoreReportReason>("claims_ownership");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  const send = async () => {
    setBusy(true);
    setError(null);
    const result = target.kind === "order" ? await reportStore(reason, details, target.orderId) : await reportResellerStore(target.relationshipId, storeId, reason, details);
    setBusy(false);
    if (result.ok) {
      setSent(result.data.number);
      setOpen(false);
    } else setError(result.message);
  };

  if (sent) return <p className="rounded-xl bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800">Thank you. Your report {sent} is with Udozo, and we will tell you what we decide.</p>;
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-slate-600 hover:text-brand-700 hover:underline">
        <Flag className="size-4" aria-hidden="true" /> Report {target.kind === "order" ? target.storeName : "one of their stores"}
      </button>
    );
  }
  return (
    <section aria-labelledby={`${id}-title`} className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-sm">
      <h2 id={`${id}-title`} className="font-bold">
        Report {target.kind === "order" ? target.storeName : "a store"} to Udozo
      </h2>
      <p className="text-slate-600">For a store that says it owns or makes the items, says what the supplier did not, asks for payment outside Udozo or misuses a buyer’s details. Problems with the item itself go in a dispute.</p>
      {target.kind === "reseller" && target.stores.length > 1 ? (
        <label className="grid gap-1">
          <span className="font-semibold">Store</span>
          <select value={storeId} onChange={event => setStoreId(event.target.value)} className="h-11 rounded-xl border border-slate-300 bg-white px-3">
            {target.stores.map(store => (
              <option key={store.id} value={store.id}>
                {store.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <fieldset className="grid gap-1.5">
        <legend className="mb-1 font-semibold">What did the store do?</legend>
        {reasons.map(value => (
          <label key={value} className="flex items-center gap-2">
            <input type="radio" name={`${id}-reason`} value={value} checked={reason === value} onChange={() => setReason(value)} className="size-4 accent-navy-900" />
            {storeReportReasonLabels[value]}
          </label>
        ))}
      </fieldset>
      <label className="grid gap-1">
        <span className="font-semibold">What happened</span>
        <textarea rows={4} maxLength={2000} value={details} onChange={event => setDetails(event.target.value)} className="rounded-xl border border-slate-300 p-3" placeholder="Where you saw it and what it said." />
      </label>
      {error ? <p className="text-brand-700">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy || details.trim().length < 10} onClick={() => void send()} className="h-11 rounded-xl bg-navy-900 px-4 font-bold text-white disabled:opacity-60">
          Send report
        </button>
        <button type="button" onClick={() => setOpen(false)} className="h-11 rounded-xl border border-slate-300 bg-white px-4 font-semibold">
          Cancel
        </button>
      </div>
    </section>
  );
}
