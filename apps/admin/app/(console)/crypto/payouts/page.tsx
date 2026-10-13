"use client";

import { useState } from "react";
import { Badge, Card, DataTable, errorMessage, FilterSelect, formatDateTime, formatMoney, PageHeader, type Column, type Tone } from "@bitocard/admin-ui";
import { AdminShell, AppLink } from "@bitocard/admin-ui/shell";
import { type CustomerPayout, type Mode, useCustomerPayoutsQuery } from "@bitocard/api-client/admin";

const tones: Record<CustomerPayout["status"], Tone> = { pending: "amber", processing: "blue", paid: "green", failed: "red" };

const columns: Array<Column<CustomerPayout>> = [
  {
    key: "payout",
    header: "Payout",
    cell: payout => (
      <span className="block">
        <span className="block font-semibold text-ink">{formatMoney(payout.amount, payout.currency)}</span>
        <span className="block text-xs text-muted">
          {payout.reference} · {formatDateTime(payout.created_at)}
        </span>
      </span>
    ),
  },
  {
    key: "customer",
    header: "Customer",
    cell: payout => (
      <AppLink href={`/crypto/customers/${payout.customer.id}`} className="text-brand-600 hover:underline">
        {payout.customer.email}
      </AppLink>
    ),
  },
  {
    key: "account",
    header: "Bank account",
    hideOnMobile: true,
    cell: payout => (
      <span className="block">
        <span className="block">{payout.bank_account ? `${payout.bank_account.bank_name} ••••${payout.bank_account.account_number_last4}` : "Removed"}</span>
        <span className="block text-xs text-muted">{payout.account_name}</span>
      </span>
    ),
  },
  {
    key: "status",
    header: "Status",
    cell: payout => (
      <span className="flex flex-col items-start gap-1">
        <Badge tone={tones[payout.status]}>{payout.status}</Badge>
        {payout.failure_reason ? <span className="text-xs text-muted">{payout.failure_reason}</span> : null}
        {payout.needs_review ? <span className="text-xs font-semibold text-red-700">Outcome unclear: check with {payout.provider}</span> : null}
      </span>
    ),
  },
];

/** Crypto > P2P payouts: store customers' P2P money paid out to their own bank accounts. */
export default function CustomerPayoutsPage() {
  const [mode, setMode] = useState<Mode>("live");
  const [status, setStatus] = useState("");
  const payouts = useCustomerPayoutsQuery({ mode, ...(status ? { status } : {}) });
  return (
    <AdminShell section="crypto" current="/crypto/payouts" crumbs={[{ label: "Crypto", href: "/crypto" }, { label: "P2P payouts" }]}>
      <PageHeader
        title="P2P payouts"
        description="Customers' P2P money paid out to bank accounts in their verified name. Set aside while the bank transfer runs; returned only if the bank refused it."
      />
      <div className="mt-6 flex flex-wrap gap-3">
        <FilterSelect id="payouts-mode" label="Mode" value={mode} onChange={value => setMode(value as Mode)} options={[{ value: "live", label: "Live" }, { value: "test", label: "Test" }]} />
        <FilterSelect
          id="payouts-status"
          label="Status"
          value={status}
          onChange={setStatus}
          options={[
            { value: "", label: "All" },
            { value: "pending", label: "Pending (unclear)" },
            { value: "processing", label: "Processing" },
            { value: "paid", label: "Paid" },
            { value: "failed", label: "Failed" },
          ]}
        />
      </div>
      <Card className="mt-4">
        <DataTable columns={columns} rows={payouts.data?.data} rowKey={payout => payout.id} loading={payouts.isLoading} error={payouts.error ? errorMessage(payouts.error) : null} onRetry={payouts.refetch} empty="No payouts yet." />
      </Card>
    </AdminShell>
  );
}
