"use client";

import { useEffect, useState } from "react";
import { money, type PosSale, type PosTransferRequest, timeLeft, transferOutcome } from "@/lib/pos";
import { cancelTransfer, transferStatus } from "@/lib/pos-actions";

/**
 * Waiting for the buyer's transfer into this till's Udozo account: the bank, the account number and name to give them,
 * the exact amount, and the time left. The till asks every 3 seconds; once Udozo has the money from the bank, the sale is
 * made and handed back. A transfer that comes after the till stops waiting is kept under Payments, to attach or keep.
 */
export function TransferWait({
  request,
  onPaid,
  onClosed,
}: {
  request: PosTransferRequest;
  onPaid: (sale: PosSale) => void;
  onClosed: (message: string) => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let stopped = false;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const poll = async () => {
      if (stopped) return;
      const result = await transferStatus(request.id);
      if (stopped) return;
      if (result.ok) {
        if (result.data.status === "paid" && result.data.sale) return onPaid(result.data.sale);
        const outcome = transferOutcome(result.data);
        if (outcome) return onClosed(outcome);
      }
      setTimeout(poll, 3000);
    };
    const first = setTimeout(poll, 3000);
    return () => {
      stopped = true;
      clearInterval(tick);
      clearTimeout(first);
    };
  }, [request.id, onPaid, onClosed]);

  const cancel = async () => {
    setBusy(true);
    await cancelTransfer(request.id);
    onClosed("The request was cancelled. A transfer that still comes is kept under Payments.");
  };

  return (
    <div className="grid gap-3" role="status">
      <p className="text-center font-semibold text-pos-ink">
        Ask the buyer to transfer exactly{" "}
        <span className="font-display text-2xl">{money(request.amount, request.currency)}</span>
      </p>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 rounded-xl bg-pos-50 p-4">
        <dt className="text-pos-muted">Bank</dt>
        <dd className="font-semibold text-pos-ink">{request.pay_to.bank_name}</dd>
        <dt className="text-pos-muted">Account number</dt>
        <dd className="font-display text-2xl font-bold tracking-wide text-pos-ink">{request.pay_to.account_number}</dd>
        <dt className="text-pos-muted">Name</dt>
        <dd className="text-pos-ink">{request.pay_to.account_name}</dd>
      </dl>
      <p className="text-center text-sm text-pos-ink-2">The sale completes by itself when the bank tells Udozo. A different amount does not complete it.</p>
      <p className="text-center text-sm text-pos-muted">
        {request.number} · {timeLeft(request.expires_at, now)} left
      </p>
      <button type="button" onClick={cancel} disabled={busy} className="h-12 rounded-xl border border-pos-line font-bold disabled:opacity-50">
        Cancel
      </button>
    </div>
  );
}
