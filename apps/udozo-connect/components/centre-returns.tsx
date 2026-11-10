"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { askReturn, handBack } from "@/lib/centre-actions";
import { type CentreReturn, type ReturnReason, returnReasonWords, returnStatusWords } from "@/lib/centres";
import { when } from "@/lib/connect";
import { useConfirm } from "./confirm-dialog";
import { input, label, Panel, primary, Problem, secondary } from "./centre-ui";

/** Asks to return an item to its seller: why, and a note. The seller accepts it, Udozo approves it, or it is accepted by itself. */
export function AskReturn({ centre, order, reasons }: { centre: string; order: string; reasons: ReturnReason[] }) {
  const router = useRouter();
  const ids = useId();
  const [reason, setReason] = useState<ReturnReason>(reasons[0]!);
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const [confirm, dialog] = useConfirm();
  const ask = async () => {
    const answer = await confirm({
      title: "Ask to return it to the seller?",
      body: `${returnReasonWords[reason]}. The seller and Udozo are told; it is accepted by itself if nobody answers in time. Keep the item safe until the seller collects it.`,
      action: "Ask for the return",
    });
    if (!answer) return;
    start(async () => {
      const result = await askReturn(centre, order, reason, note);
      if (result.ok) router.refresh();
      else setProblem(result.message);
    });
  };
  return (
    <Panel title="Return it to the seller">
      {dialog}
      <div className="grid gap-3">
        {reasons.length > 1 ? (
          <label className={label} htmlFor={`${ids}-reason`}>
            Why
            <select id={`${ids}-reason`} className={input} value={reason} onChange={event => setReason(event.target.value as ReturnReason)}>
              {reasons.map(item => (
                <option key={item} value={item}>
                  {returnReasonWords[item]}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="text-sm">{returnReasonWords[reason]}: its return is due once the free time to collect has passed by the market&apos;s days.</p>
        )}
        <label className={label} htmlFor={`${ids}-note`}>
          Note (optional)
          <input id={`${ids}-note`} className={input} value={note} onChange={event => setNote(event.target.value)} maxLength={300} />
        </label>
        <Problem message={problem} />
        <div>
          <button type="button" className={secondary} disabled={busy} onClick={ask}>
            Ask for the return
          </button>
        </div>
      </div>
    </Panel>
  );
}

/** The centre's returns: waiting for an answer, and accepted ones to hand back against the seller's return code. */
export function ReturnsList({ centre, country, returns }: { centre: string; country: string; returns: CentreReturn[] }) {
  const router = useRouter();
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [problems, setProblems] = useState<Record<string, string | null>>({});
  const [busy, start] = useTransition();
  if (!returns.length) return <p className="rounded-2xl border border-slate-100 bg-white p-4 text-slate-600">No returns waiting.</p>;
  return (
    <ul className="grid gap-3">
      {returns.map(item => (
        <li key={item.id} className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
          <p className="text-sm font-semibold text-slate-500">
            {item.number} · {item.order.number}
          </p>
          <p className="font-bold text-navy-900">{item.order.title}</p>
          <p className="text-sm text-slate-600">
            {returnReasonWords[item.reason]} · for {item.seller.name}
          </p>
          <p className="mt-1 text-sm font-semibold text-navy-900">{returnStatusWords[item.status]}</p>
          {item.status === "requested" ? <p className="text-xs text-slate-500">Accepted by itself on {when(item.answer_by, country)} if nobody answers.</p> : null}
          {item.status === "accepted" ? (
            <form
              className="mt-3 flex flex-wrap items-end gap-2"
              onSubmit={event => {
                event.preventDefault();
                start(async () => {
                  const result = await handBack(centre, item.id, codes[item.id] ?? "");
                  setProblems(current => ({ ...current, [item.id]: result.ok ? null : result.message }));
                  if (result.ok) router.refresh();
                });
              }}
            >
              <label className={`${label} min-w-0 flex-1`} htmlFor={`code-${item.id}`}>
                The seller&apos;s 6-digit return code
                <input id={`code-${item.id}`} className={`${input} tracking-[0.3em]`} value={codes[item.id] ?? ""} onChange={event => setCodes(current => ({ ...current, [item.id]: event.target.value }))} inputMode="numeric" autoComplete="one-time-code" maxLength={7} />
              </label>
              <button type="submit" className={primary} disabled={busy || (codes[item.id] ?? "").replace(/\s/g, "").length !== 6}>
                Hand it back
              </button>
              {item.collect_by ? <p className="w-full text-xs text-slate-500">The seller has until {when(item.collect_by, country)}.</p> : null}
              {problems[item.id] ? (
                <p className="w-full text-sm font-semibold text-red-700" role="alert">
                  {problems[item.id]}
                </p>
              ) : null}
            </form>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
