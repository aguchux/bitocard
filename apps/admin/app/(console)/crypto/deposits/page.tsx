"use client";

import { useState } from "react";
import { Badge, Card, DataTable, errorMessage, FilterSelect, formatDateTime, PageHeader, type Column, type Tone } from "@bitocard/admin-ui";
import { AdminShell, AppLink } from "@bitocard/admin-ui/shell";
import { type CryptoDeposit, type Mode, useCryptoDepositsQuery } from "@bitocard/api-client/admin";

const tones: Record<CryptoDeposit["status"], Tone> = { pending: "amber", credited: "green", ignored: "grey", failed: "red" };

const columns: Array<Column<CryptoDeposit>> = [
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
    header: "Customer",
    cell: deposit => (
      <AppLink href={`/crypto/customers/${deposit.customer.id}`} className="text-brand-600 hover:underline">
        {deposit.customer.email}
      </AppLink>
    ),
  },
  { key: "tx", header: "Transaction", hideOnMobile: true, cell: deposit => <span className="block max-w-56 truncate font-mono text-xs" title={deposit.tx_hash}>{deposit.tx_hash}</span> },
  { key: "confirmations", header: "Confirmations", hideOnMobile: true, cell: deposit => `${deposit.confirmations}${deposit.confirmations_needed ? ` / ${deposit.confirmations_needed}` : ""}` },
  { key: "by", header: "Confirmed by", hideOnMobile: true, cell: deposit => deposit.confirmed_by.join(", ") },
  { key: "status", header: "Status", cell: deposit => <Badge tone={tones[deposit.status]}>{deposit.status}</Badge> },
];

/** Crypto > Deposits: transfers to customers' addresses seen on chain, pending until confirmed, then credited once. */
export default function DepositsPage() {
  const [mode, setMode] = useState<Mode>("live");
  const [status, setStatus] = useState("");
  const deposits = useCryptoDepositsQuery({ mode, ...(status ? { status } : {}) });
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
      <Card className="mt-4">
        <DataTable columns={columns} rows={deposits.data?.data} rowKey={deposit => deposit.id} loading={deposits.isLoading} error={deposits.error ? errorMessage(deposits.error) : null} onRetry={deposits.refetch} empty="No deposits yet." />
      </Card>
    </AdminShell>
  );
}
