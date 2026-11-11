"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ApprovalBox } from "@/components/approval-box";
import { useConfirm } from "@/components/confirm-dialog";
import type { PosApprover } from "@/lib/pos";
import { type Approval, refundSale } from "@/lib/pos-actions";

/** Refunding a whole sale: the shop pays it back as it was paid; its items go back into stock unless the box is cleared. */
export function RefundSale({ id, number, total, approvers = [] }: { id: string; number: string; total: string; approvers?: PosApprover[] }) {
  const router = useRouter();
  const [confirm, dialog] = useConfirm();
  const [restock, setRestock] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // A refund this member of staff may only make with a manager's PIN: asked here, then sent again.
  const [approving, setApproving] = useState<{ reason: string; refundReason: string } | null>(null);

  const send = (reason: string, approval: Approval | null = null) =>
    start(async () => {
      const result = await refundSale(id, reason, restock, approval);
      if (!result.ok) {
        if (result.code === "approval_required" || result.code === "approval_invalid") {
          setApproving({ reason: result.message, refundReason: reason });
          setMessage(null);
          return;
        }
        setMessage(result.message);
        return;
      }
      setApproving(null);
      setMessage(null);
      router.refresh();
    });

  const refund = async () => {
    const answer = await confirm({
      title: `Refund ${number}?`,
      body: (
        <p>
          Pay {total} back to the customer the way they paid. {restock ? "Its items go back into stock." : "Its items stay out of stock."} This cannot be undone.
        </p>
      ),
      action: "Refund the sale",
      tone: "danger",
      reason: { label: "Why is it refunded?", required: true, placeholder: "Returned unopened" },
    });
    if (!answer) return;
    send(answer.reason);
  };

  return (
    <section aria-labelledby="refund" className="grid gap-3 rounded-[20px] bg-white p-5">
      <h2 id="refund" className="font-display text-xl font-bold text-pos-ink">
        Refund
      </h2>
      <label className="flex items-center gap-2 text-pos-ink-2">
        <input type="checkbox" checked={restock} onChange={event => setRestock(event.target.checked)} className="size-5" />
        Put its items back into stock
      </label>
      {approving ? <ApprovalBox approvers={approvers} what="refund" reason={approving.reason} pending={pending} onApprove={approval => send(approving.refundReason, approval)} onCancel={() => setApproving(null)} /> : null}
      {message ? (
        <p role="alert" className="text-pos-error">
          {message}
        </p>
      ) : null}
      <button type="button" onClick={refund} disabled={pending} className="inline-flex h-12 w-fit items-center rounded-xl border border-pos-error px-5 font-bold text-pos-error hover:bg-pos-warn-bg disabled:opacity-50">
        {pending ? "Refunding…" : "Refund this sale"}
      </button>
      {dialog}
    </section>
  );
}
