"use client";

import { useState } from "react";
import { PlusCircle } from "lucide-react";
import { Button, errorMessage, formatMoney, ManualTopUpsList, Notice, Skeleton, WalletTopUpDialog } from "@bitocard/admin-ui";
import { can, useAdmin } from "@bitocard/admin-ui/shell";
import {
  type ManualTopUp,
  type ManualTopUpInput,
  useCancelTopUpMutation,
  useConfirmTopUpMutation,
  useManualTopUpsQuery,
  useRequestCustomerTopUpMutation,
  useRequestResellerTopUpMutation,
  useResendTopUpCodeMutation,
} from "@bitocard/api-client/admin";

type Target = { type: "reseller"; id: string } | { type: "customer"; id: string };

/**
 * Finance's manual top-up of a reseller's or customer's wallet: the button opens the two-step dialog (details, then
 * the admin's authenticator code or the code emailed to them), and the latest top-ups are listed below it. Other roles see the list only.
 */
export function WalletTopUp({
  target,
  targetName,
  currencies,
  modeNote,
}: {
  target: Target;
  targetName: string;
  currencies: Array<{ code: string | null; label: string; currency: string }>;
  modeNote?: string;
}) {
  const admin = useAdmin();
  const finance = can(admin, "finance");
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<ManualTopUp | null>(null);
  const list = useManualTopUpsQuery(target.type === "reseller" ? { reseller_id: target.id } : { customer_id: target.id });
  const [requestReseller] = useRequestResellerTopUpMutation();
  const [requestCustomer] = useRequestCustomerTopUpMutation();
  const [confirm] = useConfirmTopUpMutation();
  const [resend] = useResendTopUpCodeMutation();
  const [cancel] = useCancelTopUpMutation();

  const request = (input: ManualTopUpInput) => (target.type === "reseller" ? requestReseller({ id: target.id, ...input }) : requestCustomer({ id: target.id, ...input })).unwrap();

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">Manual top-ups</h3>
        {finance ? (
          <Button
            size="sm"
            icon={<PlusCircle className="size-4" aria-hidden />}
            onClick={() => {
              setDone(null);
              setOpen(true);
            }}
          >
            Top up wallet
          </Button>
        ) : null}
      </div>
      {done ? <Notice tone="green">{`${formatMoney(done.amount, done.currency)} added to ${targetName}'s wallet (${done.number}).`}</Notice> : null}
      {list.isLoading ? <Skeleton className="h-12 w-full" /> : !list.data && list.error ? <Notice tone="red">{errorMessage(list.error)}</Notice> : <ManualTopUpsList topUps={list.data?.data ?? []} />}
      {finance ? (
        <WalletTopUpDialog
          open={open}
          onClose={() => setOpen(false)}
          targetName={targetName}
          currencies={currencies}
          chooseMode={target.type === "reseller"}
          modeNote={modeNote}
          onRequest={request}
          onConfirm={(id, code, method) => confirm({ id, code, method }).unwrap()}
          onResend={id => resend(id).unwrap()}
          onCancel={id => cancel(id).unwrap()}
          onDone={setDone}
        />
      ) : null}
    </div>
  );
}
