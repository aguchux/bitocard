"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { useConfirm } from "@/components/confirm-dialog";
import { differenceText, methodLabel, money, type PosShift, readCash, saleTime } from "@/lib/pos";
import { closeShift, openShift, shiftCash } from "@/lib/shift-actions";

const primary = "flex h-12 items-center justify-center rounded-xl bg-pos-600 px-6 font-bold text-white hover:bg-pos-700 disabled:opacity-60";
const quiet = "flex h-12 items-center justify-center rounded-xl border border-pos-line bg-white px-5 font-semibold text-pos-ink hover:bg-pos-50 disabled:opacity-60";
const input = "mt-1 h-12 w-full rounded-xl border border-pos-line bg-white px-3 text-pos-ink focus:border-pos-600 focus:ring-2 focus:ring-pos-50 focus:outline-none";
const label = "block text-sm font-semibold text-pos-ink-2";

function Message({ state }: { state: { ok: boolean; message: string } | null }) {
  if (!state) return null;
  return (
    <p role={state.ok ? "status" : "alert"} className={state.ok ? "font-semibold text-pos-700" : "font-semibold text-pos-error"}>
      {state.message}
    </p>
  );
}

/** What an open shift has taken so far: sales, refunds, by method, cash in and out, and (not for blind counters) the cash expected. */
export function ShiftFigures({ shift }: { shift: PosShift }) {
  const at = (amount: number) => money(amount, shift.currency);
  return (
    <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-sm">
      <dt>Opening float</dt>
      <dd className="text-right">{at(shift.opening_float)}</dd>
      <dt>Sales</dt>
      <dd className="text-right">
        {shift.totals.sales} · {at(shift.totals.sales_total)}
      </dd>
      {Object.entries(shift.totals.by_method).map(([method, amount]) => (
        <div key={method} className="contents text-pos-muted">
          <dt className="pl-3">{methodLabel(method)}</dt>
          <dd className="text-right">{at(amount)}</dd>
        </div>
      ))}
      <dt>Refunds</dt>
      <dd className="text-right">
        {shift.totals.refunds} · {at(shift.totals.refunds_total)}
      </dd>
      <dt>Cash paid in</dt>
      <dd className="text-right">{at(shift.totals.paid_in)}</dd>
      <dt>Cash paid out</dt>
      <dd className="text-right">{at(shift.totals.paid_out)}</dd>
      {shift.expected_cash !== null ? (
        <>
          <dt className="font-semibold">Cash expected in the drawer</dt>
          <dd className="text-right font-semibold">{at(shift.expected_cash)}</dd>
        </>
      ) : null}
    </dl>
  );
}

/**
 * A till's shift (S8): with none open, opening one with the cash in the drawer; once open, what it has taken, cash paid
 * in or out with why, and closing it with the cash counted. Staff who count blind never see what was expected; the
 * owner and managers see whether it balanced.
 */
export function ShiftPanel({ tillId, tillName, currency, shift, canOpen }: { tillId: string; tillName: string; currency: string; shift: PosShift | null; canOpen: boolean }) {
  const router = useRouter();
  const ids = useId();
  const [confirm, dialog] = useConfirm();
  const [float, setFloat] = useState("");
  const [cash, setCash] = useState({ kind: "out" as "in" | "out", amount: "", reason: "" });
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const [state, setState] = useState<{ ok: boolean; message: string } | null>(null);
  const [closed, setClosed] = useState<PosShift | null>(null);
  const [pending, start] = useTransition();

  if (closed) {
    const balance = differenceText(closed.difference, currency);
    return (
      <div className="grid gap-3" role="status">
        <p className="font-display text-xl font-bold text-pos-ink">{tillName}&apos;s shift is closed.</p>
        <p className="text-pos-ink-2">
          Counted {money(closed.counted_cash ?? 0, currency)}
          {balance ? ` · ${balance}` : ". The owner or a manager sees whether it balanced."}
        </p>
        <a href={`/app/shifts/${closed.id}`} className={quiet}>
          See the shift report
        </a>
      </div>
    );
  }

  if (!shift) {
    if (!canOpen) return <p className="text-pos-ink-2">No shift is open at {tillName}.</p>;
    return (
      <form
        className="grid gap-3"
        onSubmit={event => {
          event.preventDefault();
          const value = float.trim() ? readCash(float) : 0;
          if (value === null) return setState({ ok: false, message: "Give the cash in the drawer, such as 20000." });
          start(async () => {
            const result = await openShift(tillId, value);
            setState(result.ok ? { ok: true, message: "Shift opened." } : { ok: false, message: result.message });
            if (result.ok) router.refresh();
          });
        }}
      >
        <p className="text-pos-ink-2">No shift is open at {tillName}. Count the cash in the drawer, then open the shift.</p>
        <div>
          <label htmlFor={`${ids}-float`} className={label}>
            Cash in the drawer ({currency})
          </label>
          <input id={`${ids}-float`} value={float} onChange={event => setFloat(event.target.value)} inputMode="decimal" placeholder="0" className={input} />
        </div>
        <button type="submit" disabled={pending} className={primary}>
          Open shift
        </button>
        <Message state={state} />
      </form>
    );
  }

  return (
    <div className="grid gap-4">
      <p className="text-pos-ink-2">
        Open since {saleTime(shift.opened_at)} · {shift.opened_by}
      </p>
      <ShiftFigures shift={shift} />

      <form
        className="grid gap-3 border-t border-pos-line pt-4"
        onSubmit={event => {
          event.preventDefault();
          const amount = readCash(cash.amount);
          if (!amount) return setState({ ok: false, message: "Give how much cash." });
          if (!cash.reason.trim()) return setState({ ok: false, message: "Say why the cash went in or out." });
          start(async () => {
            const result = await shiftCash(shift.id, cash.kind, amount, cash.reason);
            setState(result.ok ? { ok: true, message: `Cash ${cash.kind === "in" ? "paid in" : "paid out"} recorded.` } : { ok: false, message: result.message });
            if (result.ok) {
              setCash({ kind: cash.kind, amount: "", reason: "" });
              router.refresh();
            }
          });
        }}
      >
        <fieldset className="flex flex-wrap gap-4">
          <legend className={label}>Cash in or out of the drawer</legend>
          {(["out", "in"] as const).map(kind => (
            <label key={kind} className="flex items-center gap-2 font-semibold text-pos-ink">
              <input type="radio" name={`${ids}-kind`} checked={cash.kind === kind} onChange={() => setCash({ ...cash, kind })} className="size-5 accent-pos-600" />
              {kind === "out" ? "Paid out" : "Paid in"}
            </label>
          ))}
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <div>
            <label htmlFor={`${ids}-amount`} className={label}>
              Amount ({currency})
            </label>
            <input id={`${ids}-amount`} value={cash.amount} onChange={event => setCash({ ...cash, amount: event.target.value })} inputMode="decimal" className={input} />
          </div>
          <div>
            <label htmlFor={`${ids}-reason`} className={label}>
              Why
            </label>
            <input id={`${ids}-reason`} value={cash.reason} onChange={event => setCash({ ...cash, reason: event.target.value })} maxLength={200} placeholder="Paid the delivery man" className={input} />
          </div>
        </div>
        <button type="submit" disabled={pending} className={quiet}>
          Record cash {cash.kind === "in" ? "paid in" : "paid out"}
        </button>
      </form>

      <form
        className="grid gap-3 border-t border-pos-line pt-4"
        onSubmit={async event => {
          event.preventDefault();
          const value = readCash(counted);
          if (value === null) return setState({ ok: false, message: "Count the cash in the drawer and give the total." });
          if (!(await confirm({ title: `Close ${tillName}'s shift?`, body: <p>You counted {money(value, currency)} in the drawer. Nothing more can be rung up in this shift once it closes.</p>, action: "Close shift" }))) return;
          start(async () => {
            const result = await closeShift(shift.id, value, note);
            if (!result.ok) return setState({ ok: false, message: result.message });
            setState(null);
            setClosed(result.data);
            router.refresh();
          });
        }}
      >
        <div>
          <label htmlFor={`${ids}-counted`} className={label}>
            Cash counted in the drawer ({currency})
          </label>
          <input id={`${ids}-counted`} value={counted} onChange={event => setCounted(event.target.value)} inputMode="decimal" required className={input} />
        </div>
        <div>
          <label htmlFor={`${ids}-note`} className={label}>
            Note (optional)
          </label>
          <input id={`${ids}-note`} value={note} onChange={event => setNote(event.target.value)} maxLength={300} className={input} />
        </div>
        <button type="submit" disabled={pending} className={primary}>
          Count and close shift
        </button>
      </form>
      <Message state={state} />
      {dialog}
    </div>
  );
}
