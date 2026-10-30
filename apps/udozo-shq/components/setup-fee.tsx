"use client";

import { useState } from "react";
import { BadgeCheck, Receipt } from "lucide-react";
import { ActionDialog, Badge, Button, Card, CardHeader, errorMessage, formatDate, formatMoney, Notice, Skeleton } from "@bitocard/admin-ui";
import { usePaySetupFeeMutation, useSetupFeeQuery } from "@bitocard/api-client/reseller";
import { can, useReseller } from "./reseller";

/**
 * The seller's one-time Seller HQ setup fee (Udozo): whether their market charges one, what it is, and paying it from the
 * live wallet. A store goes live only once it is paid (`setup_fee_unpaid`); taking a store's first Premium month pays it
 * at the same time.
 */
export function SetupFeeCard() {
  const { membership, mode } = useReseller();
  const fee = useSetupFeeQuery();
  const [pay, state] = usePaySetupFeeMutation();
  const [confirming, setConfirming] = useState(false);
  const canPay = can(membership, "finance");
  const data = fee.data;
  const amount = data?.currency && data.amount !== null ? formatMoney(data.amount, data.currency) : null;
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Receipt className="size-5 text-brand-600" aria-hidden /> Seller HQ setup fee
          </span>
        }
        description="A one-time fee, set by Udozo for your market. Your stores go live once it is paid."
        actions={data ? data.due ? <Badge tone="amber">Due</Badge> : data.paid_at ? <Badge tone="green">Paid</Badge> : <Badge tone="grey">Not charged</Badge> : null}
      />
      <div className="space-y-4 px-5 pb-5 pt-4 sm:px-6">
        {fee.isLoading ? <Skeleton className="h-12 w-full" /> : null}
        {fee.error ? <Notice tone="red">{errorMessage(fee.error, "Could not load your setup fee.")}</Notice> : null}
        {data?.due ? (
          <>
            <p className="text-sm text-ink">
              <span className="text-2xl font-extrabold tracking-tight">{amount}</span> <span className="text-muted">once, from your live wallet.</span>
            </p>
            <p className="text-sm text-muted">Taking Premium for a store pays it with the store&apos;s first month, and the two together pay for its free domain.</p>
            {state.error ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
            {mode === "test" ? <Notice tone="amber">The setup fee is paid from your live wallet. Switch to live to pay it.</Notice> : null}
            {!canPay ? <Notice tone="grey">Only the owner and finance members can pay it.</Notice> : null}
            {canPay ? (
              <Button disabled={mode === "test"} loading={state.isLoading} onClick={() => setConfirming(true)}>
                Pay {amount}
              </Button>
            ) : null}
          </>
        ) : null}
        {data && !data.due && data.paid_at ? (
          <p className="flex items-center gap-2 text-sm text-ink">
            <BadgeCheck className="size-4 shrink-0 text-emerald-600" aria-hidden />
            {`Paid ${amount ? `${amount} ` : ""}on ${formatDate(data.paid_at)}. Nothing more is due.`}
          </p>
        ) : null}
        {data && !data.charged && !data.paid_at ? <p className="text-sm text-muted">Your market charges no setup fee. Nothing to pay.</p> : null}
      </div>
      <ActionDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Pay the setup fee?"
        description={`${amount ?? "The fee"} is taken once from your live wallet (topped-up funds first, then earnings).`}
        confirmLabel={`Pay ${amount ?? ""}`.trim()}
        requireReason={false}
        onConfirm={async () => {
          await pay().unwrap();
        }}
      />
    </Card>
  );
}
