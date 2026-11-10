"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { moveEarnings } from "@/lib/centre-actions";
import type { EarningsAccount, EarningsLine } from "@/lib/centres";
import { money, when } from "@/lib/connect";
import { useConfirm } from "./confirm-dialog";
import { input, label, Panel, primary, Problem } from "./centre-ui";

/** Major units typed by the owner as minor units, or null when it is not an amount. */
function toMinor(value: string) {
  const text = value.replace(/[,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const [whole, part = ""] = text.split(".");
  return Number(whole) * 100 + Number(part.padEnd(2, "0"));
}

/**
 * One currency's earnings: the balance, what is still inside the payout hold, and Move to my payouts for the rest (all
 * of it by default), after which udozo.com's Payouts pays it to the owner's bank.
 */
export function EarningsCard({ centre, account, holdDays, payoutsUrl }: { centre: string; account: EarningsAccount; holdDays: number; payoutsUrl: string }) {
  const router = useRouter();
  const ids = useId();
  const [amount, setAmount] = useState(account.available ? (account.available / 100).toFixed(2) : "");
  const [problem, setProblem] = useState<string | null>(null);
  const [moved, setMoved] = useState(false);
  const [busy, start] = useTransition();
  const [confirm, dialog] = useConfirm();
  const move = async () => {
    const minor = toMinor(amount);
    if (minor === null || minor <= 0) return setProblem("Give an amount to move.");
    if (minor > account.available) return setProblem(`You can move up to ${money(account.available, account.currency)} now.`);
    const ok = await confirm({ title: `Move ${money(minor, account.currency)} to your payouts?`, body: "You then pay it to your bank from Payouts on udozo.com.", action: "Move it" });
    if (!ok) return;
    start(async () => {
      const result = await moveEarnings(centre, account.mode, account.currency, minor);
      if (!result.ok) return setProblem(result.message);
      setProblem(null);
      setMoved(true);
      router.refresh();
    });
  };
  return (
    <Panel title={`Earnings in ${account.currency}${account.mode === "test" ? " (sandbox)" : ""}`}>
      {dialog}
      <dl className="grid grid-cols-3 gap-3 text-center">
        {[
          ["Earned", account.balance],
          ["Held", account.held],
          ["Can move", account.available],
        ].map(([name, value]) => (
          <div key={name} className="min-w-0 rounded-xl bg-slate-50 px-2 py-3">
            <dt className="text-xs font-semibold text-slate-600">{name}</dt>
            <dd className="truncate text-lg font-extrabold text-navy-900">{money(value as number, account.currency)}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-sm text-slate-600">Earnings can move {holdDays === 1 ? "a day" : `${holdDays} days`} after they are earned.</p>
      {account.available ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <div>
            <label htmlFor={`${ids}-amount`} className={label}>
              Amount ({account.currency})
            </label>
            <input id={`${ids}-amount`} inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} className={input} />
          </div>
          <button type="button" disabled={busy} onClick={move} className={primary}>
            Move to my payouts
          </button>
        </div>
      ) : null}
      {moved ? (
        <p role="status" className="mt-2 text-sm font-semibold text-navy-900">
          Moved.{" "}
          <a href={payoutsUrl} className="text-brand-700 underline">
            Pay it to your bank on udozo.com
          </a>
        </p>
      ) : null}
      <Problem message={problem} />
    </Panel>
  );
}

/** The latest earnings and moves, newest first. */
export function EarningsLines({ lines, country }: { lines: EarningsLine[]; country: string }) {
  if (!lines.length) return <p className="text-slate-600">Nothing earned yet: your share of the Connect fee is earned as each item is handed over.</p>;
  return (
    <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-100 bg-white">
      {lines.map(line => (
        <li key={line.id} className="flex items-baseline justify-between gap-3 px-4 py-3 text-sm">
          <span className="min-w-0">
            <span className="block truncate text-navy-900">{line.description}</span>
            <span className="text-slate-600">{when(line.created_at, country)}</span>
          </span>
          <span className={`shrink-0 font-semibold ${line.kind === "earned" ? "text-emerald-800" : "text-slate-700"}`}>
            {line.kind === "earned" ? "+" : "−"}
            {money(line.amount, line.currency)}
          </span>
        </li>
      ))}
    </ul>
  );
}
