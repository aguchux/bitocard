"use client";

import { useState } from "react";
import { reportSummary } from "@/lib/rating-actions";

/** Report this summary: what is wrong with it, for Udozo's team. */
export function ReportSummary({ reported }: { reported: boolean }) {
  const [open, setOpen] = useState(false);
  const [details, setDetails] = useState("");
  const [done, setDone] = useState(reported);
  const [error, setError] = useState<string | null>(null);
  if (done) return <p className="text-xs text-navy-600">You reported this summary. Udozo&apos;s team will look at it.</p>;
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="w-fit text-xs font-semibold text-navy-700 underline-offset-2 hover:underline">
        Report this summary
      </button>
    );
  return (
    <form
      className="grid gap-2"
      onSubmit={event => {
        event.preventDefault();
        void reportSummary(details).then(result => (result.ok ? setDone(true) : setError(result.message)));
      }}
    >
      <label className="grid gap-1 text-sm font-semibold">
        What is wrong with it?
        <textarea value={details} onChange={event => setDetails(event.target.value)} rows={3} maxLength={500} className="rounded-xl border border-slate-300 px-3 py-2 font-normal" />
      </label>
      {error ? (
        <p role="alert" className="text-sm text-brand-700">
          {error}
        </p>
      ) : null}
      <span className="flex gap-2">
        <button type="submit" className="min-h-10 rounded-xl bg-navy-900 px-4 text-sm font-bold text-white">
          Send report
        </button>
        <button type="button" onClick={() => setOpen(false)} className="min-h-10 rounded-xl border border-slate-300 px-4 text-sm font-semibold">
          Cancel
        </button>
      </span>
    </form>
  );
}
