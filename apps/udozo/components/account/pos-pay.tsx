"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { formatPrice } from "@bitocard/api-client/storefront";
import { useConfirm } from "@/components/confirm-dialog";
import { declinePos, payPos } from "@/lib/pos-pay-actions";
import type { PosWalletPayment } from "@/lib/pos-pay";

/**
 * Pay or decline a shop's till request: nothing is taken until the buyer presses Pay and confirms it. A wallet too low
 * links to Add funds and comes back here.
 */
export function PosPay({ token, payment }: { token: string; payment: PosWalletPayment }) {
  const router = useRouter();
  const [confirm, dialog] = useConfirm();
  const [message, setMessage] = useState<{ text: string; topUp: boolean } | null>(null);
  const [pending, start] = useTransition();
  const amount = formatPrice(payment.amount, payment.currency);

  const pay = async () => {
    const yes = await confirm({
      title: `Pay ${amount} to ${payment.shop.name}?`,
      body: <p>It comes from your Udozo wallet now, and the shop sees the sale is paid.</p>,
      action: `Pay ${amount}`,
      tone: "money",
    });
    if (!yes) return;
    start(async () => {
      const result = await payPos(token, payment.amount);
      if (result.ok) {
        setMessage(null);
        router.refresh();
        return;
      }
      setMessage({ text: result.message, topUp: result.code === "wallet_balance_low" });
      if (result.code !== "wallet_balance_low") router.refresh();
    });
  };

  const decline = async () => {
    const yes = await confirm({ title: "Decline this payment?", body: <p>Nothing is taken, and the shop sees you declined.</p>, action: "Decline", tone: "danger", dismiss: "Keep it" });
    if (!yes) return;
    start(async () => {
      const result = await declinePos(token);
      if (!result.ok) setMessage({ text: result.message, topUp: false });
      router.refresh();
    });
  };

  return (
    <div className="space-y-3">
      {message ? (
        <div role="alert" className="rounded-2xl bg-amber-50 p-4 text-sm font-semibold text-amber-900">
          <p>{message.text}</p>
          {message.topUp ? (
            <Link href={`/account/wallet?back=${encodeURIComponent(`/pay/${token}`)}`} className="mt-2 inline-flex min-h-11 items-center font-semibold underline">
              Add funds to your wallet
            </Link>
          ) : null}
        </div>
      ) : null}
      <div className="grid gap-2 sm:grid-cols-2">
        <button type="button" onClick={pay} disabled={pending} className="min-h-12 rounded-xl bg-brand-500 px-5 font-bold text-white hover:bg-brand-600 disabled:opacity-50">
          {pending ? "Paying…" : `Pay ${amount}`}
        </button>
        <button type="button" onClick={decline} disabled={pending} className="min-h-12 rounded-xl border border-slate-300 px-5 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
          Decline
        </button>
      </div>
      {dialog}
    </div>
  );
}
