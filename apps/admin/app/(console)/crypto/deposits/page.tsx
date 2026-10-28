"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Badge, Button, Card, DataTable, errorMessage, FilterSelect, formatDateTime, Notice, PageHeader, type Column, type Tone } from "@bitocard/admin-ui";
import { CoinOwnerLink } from "@/components/coin-owner";
import { AdminShell, can, useAdmin } from "@bitocard/admin-ui/shell";
import { type CryptoDeposit, type Mode, useCryptoDepositsQuery, useRecheckCryptoDepositMutation } from "@bitocard/api-client/admin";

const tones: Record<CryptoDeposit["status"], Tone> = { pending: "amber", credited: "green", ignored: "grey", failed: "red" };

const baseColumns: Array<Column<CryptoDeposit>> = [
  {
    key: "deposit",
    header: "Deposit",
    cell: deposit => (
      <span className="block">
        <span className="block font-semibold text-ink">
          {deposit.amount} {deposit.asset}
        </span>
        <span className="block text-xs text-muted">
          {deposit.network} · {formatDateTime(deposit.created_at)}
        </span>
      </span>
    ),
  },
  {
    key: "customer",
    header: "Owner",
    cell: deposit => <CoinOwnerLink customer={deposit.customer} />,
  },
  { key: "tx", header: "Transaction", hideOnMobile: true, cell: deposit => <span className="block max-w-56 truncate font-mono text-xs" title={deposit.tx_hash}>{deposit.tx_hash}</span> },
  { key: "confirmations", header: "Confirmations", hideOnMobile: true, cell: deposit => `${deposit.confirmations}${deposit.confirmations_needed ? ` / ${deposit.confirmations_needed}` : ""}` },
  { key: "by", header: "Confirmed by", hideOnMobile: true, cell: deposit => deposit.confirmed_by.join(", ") },
  { key: "status", header: "Status", cell: deposit => <Badge tone={tones[deposit.status]}>{deposit.status}</Badge> },
];

/** Crypto > Deposits: transfers to customers' addresses seen on chain, pending until confirmed, then credited once. */
export default function DepositsPage() {
  // useSearchParams needs a Suspense boundary (a customer's page links here with ?customer=<id>).
  return (
    <Suspense>
      <Deposits />
    </Suspense>
  );
}

function Deposits() {
  const customer = useSearchParams().get("customer") ?? undefined;
  const [mode, setMode] = useState<Mode>("live");
  const [status, setStatus] = useState("");
  const deposits = useCryptoDepositsQuery({ mode, ...(status ? { status } : {}), ...(customer ? { customer_id: customer } : {}) });
  const admin = useAdmin();
  const [recheck, rechecking] = useRecheckCryptoDepositMutation();
  // A deposit the chain stopped showing (or one still waiting) can be read from the chain again now.
  const columns: Array<Column<CryptoDeposit>> = can(admin, "operations")
    ? [
        ...baseColumns,
        {
          key: "recheck",
          header: "",
          align: "right",
          cell: deposit =>
            deposit.status === "failed" || deposit.status === "pending" ? (
              <Button size="sm" variant="secondary" loading={rechecking.isLoading && rechecking.originalArgs === deposit.id} onClick={() => void recheck(deposit.id)}>
                Check again
              </Button>
            ) : null,
        },
      ]
    : baseColumns;
  return (
    <AdminShell section="crypto" current="/crypto/deposits" crumbs={[{ label: "Crypto", href: "/crypto" }, { label: "Deposits" }]}>
      <PageHeader title="Deposits" description="Every transfer to a customer's deposit address, read again from the chain before it counts. Credited once it has its confirmations." />
      <div className="mt-6 flex flex-wrap gap-3">
        <FilterSelect id="deposits-mode" label="Mode" value={mode} onChange={value => setMode(value as Mode)} options={[{ value: "live", label: "Live" }, { value: "test", label: "Test" }]} />
        <FilterSelect
          id="deposits-status"
          label="Status"
          value={status}
          onChange={setStatus}
          options={[
            { value: "", label: "All" },
            { value: "pending", label: "Waiting for confirmations" },
            { value: "credited", label: "Credited" },
            { value: "ignored", label: "Too small" },
            { value: "failed", label: "Gone from the chain" },
          ]}
        />
      </div>
      {rechecking.error ? (
        <div className="mt-4">
          <Notice tone="red">{errorMessage(rechecking.error)}</Notice>
        </div>
      ) : null}
      <Card className="mt-4">
        <DataTable columns={columns} rows={deposits.data?.data} rowKey={deposit => deposit.id} loading={deposits.isLoading} error={deposits.error ? errorMessage(deposits.error) : null} onRetry={deposits.refetch} empty="No deposits yet." />
      </Card>
    </AdminShell>
  );
}
