"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import type { CheckoutStatus } from "@bitocard/api-client/storefront";

/** How each status reads to customers, and its colours. */
export const checkoutStatus: Record<CheckoutStatus, { label: string; tone: string }> = {
  awaiting_payment: { label: "Waiting for payment", tone: "bg-amber-50 text-amber-800" },
  paid: { label: "Paid, preparing your order", tone: "bg-blue-50 text-blue-800" },
  completed: { label: "Delivered", tone: "bg-emerald-50 text-emerald-800" },
  failed: { label: "Not paid", tone: "bg-slate-100 text-slate-700" },
  refund_pending: { label: "Refund on its way", tone: "bg-amber-50 text-amber-800" },
  refunded: { label: "Refunded", tone: "bg-slate-100 text-slate-700" },
};

export function StatusPill({ status }: { status: CheckoutStatus }) {
  const item = checkoutStatus[status];
  return <span className={`inline-flex rounded-full px-3 py-1 text-sm font-semibold ${item.tone}`}>{item.label}</span>;
}

/** Reloads the order every few seconds while it is still on its way (paused while the tab is hidden). */
export function RefreshWhile({ active, everyMs = 5000 }: { active: boolean; everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, everyMs);
    return () => window.clearInterval(timer);
  }, [active, everyMs, router]);
  return null;
}
