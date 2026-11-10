"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { recordStockCheck } from "@/lib/centre-actions";
import { checkWords, type StockCheck, type StockGroup } from "@/lib/centres";
import { when } from "@/lib/connect";
import { useConfirm } from "./confirm-dialog";
import { input, label, Panel, primary, Problem } from "./centre-ui";

/**
 * One storage place's stock check: every item that should be on it, ticked as staff find it. Saving flags what was not
 * ticked to Udozo at once (after a confirmation naming how many), and clears a flag on anything found again.
 */
export function StockShelf({ centre, country, group }: { centre: string; country: string; group: StockGroup }) {
  const router = useRouter();
  const ids = useId();
  const [found, setFound] = useState<Set<string>>(() => new Set());
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState<StockCheck | null>(null);
  const [busy, start] = useTransition();
  const [confirm, dialog] = useConfirm();
  const title = group.shelf ? `${group.shelf.code}${group.shelf.label ? ` · ${group.shelf.label}` : ""}` : "Not on a storage place";
  const missing = group.items.length - found.size;
  const toggle = (id: string) =>
    setFound(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const save = async () => {
    if (missing) {
      const ok = await confirm({
        title: `${missing === 1 ? "1 item is" : `${missing} items are`} not ticked`,
        body: "Udozo is told at once that they are missing from this centre. Look again first if you can.",
        action: "Save the check",
        tone: "danger",
      });
      if (!ok) return;
    }
    start(async () => {
      const result = await recordStockCheck(centre, group.shelf?.id ?? null, [...found], note);
      if (!result.ok) return setProblem(result.message);
      setProblem(null);
      setSaved(result.data);
      setFound(new Set());
      setNote("");
      router.refresh();
    });
  };
  return (
    <Panel title={title} tone={group.items.some(item => item.missing_since) ? "warn" : undefined}>
      {dialog}
      {group.items.length ? (
        <>
          <ul className="grid gap-1">
            {group.items.map(item => (
              <li key={item.order_id}>
                <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-2 hover:bg-slate-50">
                  <input type="checkbox" checked={found.has(item.order_id)} onChange={() => toggle(item.order_id)} className="size-5 shrink-0 accent-navy-900" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-navy-900">{item.title}</span>
                    <span className="text-sm text-slate-600">
                      {item.number}
                      {item.missing_since ? <span className="font-semibold text-red-700"> · Missing since {when(item.missing_since, country)}</span> : item.seen_at ? ` · Last seen ${when(item.seen_at, country)}` : ""}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <div className="mt-3 grid gap-3">
            <div>
              <label htmlFor={`${ids}-note`} className={label}>
                Note (optional)
              </label>
              <input id={`${ids}-note`} value={note} maxLength={300} onChange={event => setNote(event.target.value)} className={input} />
            </div>
            <p className="text-sm text-slate-600">
              {found.size} of {group.items.length} ticked
            </p>
            <button type="button" disabled={busy} onClick={save} className={primary}>
              Save the check
            </button>
          </div>
        </>
      ) : (
        <p className="text-slate-600">Nothing should be here.</p>
      )}
      {saved ? (
        <p role="status" className="mt-2 text-sm font-semibold text-navy-900">
          Saved: {checkWords(saved)}.{saved.flagged ? " Udozo has been told." : ""}
        </p>
      ) : null}
      <Problem message={problem} />
    </Panel>
  );
}

/** The centre's latest stock checks: when, which storage place, who, and what was missing. */
export function StockHistory({ checks, country }: { checks: StockCheck[]; country: string }) {
  if (!checks.length) return <p className="text-slate-600">No stock checks yet.</p>;
  return (
    <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-100 bg-white">
      {checks.map(check => (
        <li key={check.id} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3 text-sm">
          <span className="min-w-0">
            <strong className="text-navy-900">{check.shelf?.code ?? "Whole centre"}</strong>
            <span className="text-slate-600">
              {" "}
              · {when(check.created_at, country)}
              {check.checked_by ? ` · ${check.checked_by}` : ""}
            </span>
            {check.note ? <span className="block text-slate-600">{check.note}</span> : null}
          </span>
          <span className={check.missing ? "font-semibold text-red-700" : "text-emerald-800"}>{checkWords(check)}</span>
        </li>
      ))}
    </ul>
  );
}
