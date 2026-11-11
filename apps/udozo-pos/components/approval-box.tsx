"use client";

import { useState } from "react";
import { PinPad } from "@/components/pin-pad";
import type { PosApprover } from "@/lib/pos";
import type { Approval } from "@/lib/pos-actions";

/** Who may approve what: a bigger discount (they sell, their own limit holding), a refund, or a stock change. */
export type ApprovalFor = "discount" | "refund" | "stock_adjust";
export const approversFor = (approvers: PosApprover[], what: ApprovalFor) =>
  approvers.filter(item => (what === "refund" ? item.refund : what === "stock_adjust" ? item.stock_adjust : item.discount_limit_bps !== 0));

/**
 * A manager's approval at the till: they choose their name and enter their own PIN on this screen, for something the
 * member of staff may only do with approval. Their PIN counts towards their own lockout and is never kept here.
 */
export function ApprovalBox({ approvers, what, reason, pending, onApprove, onCancel }: { approvers: PosApprover[]; what: ApprovalFor; reason: string; pending: boolean; onApprove: (approval: Approval) => void; onCancel: () => void }) {
  const list = approversFor(approvers, what);
  const [staffId, setStaffId] = useState(list[0]?.id ?? "");
  const [pin, setPin] = useState("");
  return (
    <section aria-labelledby="approval" className="grid gap-3 rounded-[20px] border-2 border-pos-warn bg-pos-warn-bg p-5">
      <h2 id="approval" className="font-display text-xl font-bold text-pos-ink">
        A manager’s approval
      </h2>
      <p className="text-pos-ink-2">{reason}</p>
      {list.length ? (
        <form
          onSubmit={event => {
            event.preventDefault();
            if (staffId && /^(?:\d{4}|\d{6})$/.test(pin)) onApprove({ staff_id: staffId, pin });
          }}
          className="grid gap-3"
        >
          <label className="text-sm font-semibold text-pos-ink-2">
            Who approves it
            <select value={staffId} onChange={event => setStaffId(event.target.value)} className="mt-1 h-12 w-full rounded-xl border border-pos-line bg-white px-4 text-base">
              {list.map(item => (
                <option key={item.id} value={item.id}>
                  {item.name} · {item.role}
                </option>
              ))}
            </select>
          </label>
          <PinPad value={pin} onChange={setPin} label="Their PIN" disabled={pending} />
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={onCancel} className="h-12 rounded-xl border border-pos-line bg-white font-bold">
              Cancel
            </button>
            <button type="submit" disabled={pending || (pin.length !== 6 && pin.length !== 4)} className="h-12 rounded-xl bg-pos-600 font-bold text-white hover:bg-pos-700 disabled:opacity-50">
              {pending ? "Checking…" : "Approve"}
            </button>
          </div>
        </form>
      ) : (
        <>
          <p className="font-semibold text-pos-ink">Nobody who works at this till may approve it. Ask the shop owner.</p>
          <button type="button" onClick={onCancel} className="h-12 w-fit rounded-xl border border-pos-line bg-white px-5 font-bold">
            Back
          </button>
        </>
      )}
    </section>
  );
}
