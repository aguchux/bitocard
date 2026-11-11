"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useConfirm } from "@/components/confirm-dialog";
import { refundSale } from "@/lib/pos-actions";

/** Refunding a whole sale: the shop pays it back as it was paid; its items go back into stock unless the box is cleared. */
export function RefundSale({ id, number, total }: { id: string; number: string; total: string }) {
  const router = useRouter();
  const [confirm, dialog] = useConfirm();
  const [restock, setRestock] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

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
    start(async () => {
      const result = await refundSale(id, answer.reason, restock);
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      setMessage(null);
      router.refresh();
    });
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
