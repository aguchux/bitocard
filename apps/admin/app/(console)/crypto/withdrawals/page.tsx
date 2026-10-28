"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { ActionDialog, Badge, Button, Card, DataTable, errorMessage, FilterSelect, formatDateTime, Notice, PageHeader, type Column, type Tone } from "@bitocard/admin-ui";
import { CoinOwnerLink } from "@/components/coin-owner";
import { AdminShell, can, useAdmin } from "@bitocard/admin-ui/shell";
import {
  type CryptoWithdrawal,
  type CryptoWithdrawalStatus,
  type Mode,
  useCryptoWithdrawalsQuery,
  useDecideCryptoWithdrawalMutation,
  useRecheckCryptoWithdrawalMutation,
} from "@bitocard/api-client/admin";

const tones: Record<CryptoWithdrawalStatus, Tone> = {
  awaiting_code: "grey",
  review: "amber",
  queued: "blue",
  submitting: "blue",
  broadcast: "blue",
  completed: "green",
  failed: "red",
  rejected: "red",
  cancelled: "grey",
};

const labels: Record<CryptoWithdrawalStatus, string> = {
  awaiting_code: "Waiting for the customer's code",
  review: "To approve",
  queued: "Queued",
  submitting: "With the signer",
  broadcast: "On chain",
  completed: "Sent",
  failed: "Failed (returned)",
  rejected: "Rejected (returned)",
  cancelled: "Cancelled",
};

const reasons: Record<string, string> = { amount: "Large amount", unscreened: "Address not screened", recent_card_top_up: "Recent card or mobile money top-up" };

type Decision = { withdrawal: CryptoWithdrawal; decision: "approve" | "reject" };

/**
 * Crypto > Withdrawals: customers' on-chain withdrawals. Finance approves those waiting for review (large amounts,
 * unscreened addresses, recent reversible top-ups); operations or finance reject them (the coins go back to the
 * customer). One waiting too long for the signer or the chain is flagged and can be checked again now.
 */
export default function WithdrawalsPage() {
  // useSearchParams needs a Suspense boundary (a customer's page links here with ?customer=<id>).
  return (
    <Suspense>
      <Withdrawals />
    </Suspense>
  );
}

function Withdrawals() {
  const customer = useSearchParams().get("customer") ?? undefined;
  const admin = useAdmin();
  const [mode, setMode] = useState<Mode>("live");
  // One customer's withdrawals: all of them, not only those waiting for review.
  const [status, setStatus] = useState(customer ? "" : "review");
  const withdrawals = useCryptoWithdrawalsQuery({ mode, ...(status ? { status } : {}), ...(customer ? { customer_id: customer } : {}) });
  const [decide] = useDecideCryptoWithdrawalMutation();
  const [recheck, rechecking] = useRecheckCryptoWithdrawalMutation();
  const [open, setOpen] = useState<Decision | null>(null);
  const approves = can(admin, "finance");
  const rejects = can(admin, "operations", "finance");

  const columns: Array<Column<CryptoWithdrawal>> = [
    {
      key: "withdrawal",
      header: "Withdrawal",
      cell: item => (
        <span className="block">
          <span className="block font-semibold text-ink">
            {item.amount} {item.asset}
          </span>
          <span className="block text-xs text-muted">
            {item.number} · {item.network} · fee {item.fee} · {formatDateTime(item.created_at)}
          </span>
        </span>
      ),
    },
    {
      key: "customer",
      header: "Owner",
      cell: item => <CoinOwnerLink customer={item.customer} />,
    },
    {
      key: "to",
      header: "To",
      hideOnMobile: true,
      cell: item => (
        <span className="block">
          <span className="block max-w-56 truncate font-mono text-xs" title={item.address}>
            {item.address}
          </span>
          <span className="block text-xs text-muted">Screening: {item.screening ?? "address removed"}{item.screened_by ? ` (${item.screened_by})` : ""}</span>
        </span>
      ),
    },
    {
      key: "chain",
      header: "On chain",
      hideOnMobile: true,
      cell: item =>
        item.tx_hash ? (
          <span className="block max-w-48 truncate font-mono text-xs" title={item.tx_hash}>
            {item.tx_hash}
          </span>
        ) : (
          <span className="text-xs text-muted">{item.error ?? "Not sent"}</span>
        ),
    },
    {
      key: "status",
      header: "Status",
      cell: item => (
        <span className="flex flex-col items-start gap-1">
          <Badge tone={tones[item.status]}>{labels[item.status]}</Badge>
          {item.review_reason ? <span className="text-xs text-muted">{reasons[item.review_reason] ?? item.review_reason}</span> : null}
          {item.needs_review ? <span className="text-xs font-semibold text-red-700">Waiting too long</span> : null}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      cell: item => (
        <span className="flex flex-wrap justify-end gap-2">
          {item.status === "review" && approves ? (
            <Button size="sm" onClick={() => setOpen({ withdrawal: item, decision: "approve" })}>
              Approve
            </Button>
          ) : null}
          {item.status === "review" && rejects ? (
            <Button size="sm" variant="secondary" onClick={() => setOpen({ withdrawal: item, decision: "reject" })}>
              Reject
            </Button>
          ) : null}
          {(item.status === "submitting" || item.status === "broadcast") && rejects ? (
            <Button size="sm" variant="secondary" loading={rechecking.isLoading && rechecking.originalArgs === item.id} onClick={() => void recheck(item.id)}>
              Check now
            </Button>
          ) : null}
        </span>
      ),
    },
  ];

  return (
    <AdminShell section="crypto" current="/crypto/withdrawals" crumbs={[{ label: "Crypto", href: "/crypto" }, { label: "Withdrawals" }]}>
      <PageHeader
        title="Withdrawals"
        description="Customers' on-chain withdrawals. BitoCard's signer sends each once; it counts as sent only when the chain shows it confirmed. Rejected or failed ones go back to the customer's wallet."
      />
      <div className="mt-6 flex flex-wrap gap-3">
        <FilterSelect id="withdrawals-mode" label="Mode" value={mode} onChange={value => setMode(value as Mode)} options={[{ value: "live", label: "Live" }, { value: "test", label: "Test" }]} />
        <FilterSelect
          id="withdrawals-status"
          label="Status"
          value={status}
          onChange={setStatus}
          options={[{ value: "", label: "All" }, ...(Object.keys(labels) as CryptoWithdrawalStatus[]).map(value => ({ value, label: labels[value] }))]}
        />
      </div>
      {rechecking.error ? (
        <div className="mt-4">
          <Notice tone="red">{errorMessage(rechecking.error)}</Notice>
        </div>
      ) : null}
      <Card className="mt-4">
        <DataTable columns={columns} rows={withdrawals.data?.data} rowKey={item => item.id} loading={withdrawals.isLoading} error={withdrawals.error ? errorMessage(withdrawals.error) : null} onRetry={withdrawals.refetch} empty="No withdrawals here." />
      </Card>
      {open ? (
        <ActionDialog
          open
          onClose={() => setOpen(null)}
          title={open.decision === "approve" ? `Send ${open.withdrawal.amount} ${open.withdrawal.asset}?` : `Reject ${open.withdrawal.number}?`}
          description={
            open.decision === "approve"
              ? `It goes to the signer at once and cannot be called back. To ${open.withdrawal.address} on ${open.withdrawal.network}.`
              : "The coins and the fee go back to the customer's wallet, and they are told it was not approved."
          }
          confirmLabel={open.decision === "approve" ? "Approve and send" : "Reject"}
          tone={open.decision === "approve" ? "primary" : "danger"}
          onConfirm={note => decide({ id: open.withdrawal.id, decision: open.decision, note }).unwrap()}
        />
      ) : null}
    </AdminShell>
  );
}
