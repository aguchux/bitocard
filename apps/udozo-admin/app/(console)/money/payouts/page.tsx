"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Badge, Card, DataTable, errorMessage, FilterSelect, formatDateTime, formatMoney, PageHeader, type Column, type Tone } from "@bitocard/admin-ui";
import { AppLink } from "@bitocard/admin-ui/shell";
import { UdozoShell } from "@/components/shell";
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
    header: "Seller",
    cell: payout => (
      <AppLink href={`/customers/${payout.customer.id}`} className="text-brand-600 hover:underline">
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

/** Money > Safe pay payouts: sellers' Safe pay sales paid out to their own bank accounts. */
export default function CustomerPayoutsPage() {
  // useSearchParams needs a Suspense boundary (a customer's page links here with ?customer=<id>).
  return (
    <Suspense>
      <CustomerPayouts />
    </Suspense>
  );
}

function CustomerPayouts() {
  const customer = useSearchParams().get("customer") ?? undefined;
  const [mode, setMode] = useState<Mode>("live");
  const [status, setStatus] = useState("");
  const payouts = useCustomerPayoutsQuery({ mode, ...(status ? { status } : {}), ...(customer ? { customer_id: customer } : {}) });
  return (
    <UdozoShell section="money" current="/money/payouts" crumbs={[{ label: "Money", href: "/money/payouts" }, { label: "Safe pay payouts" }]}>
      <PageHeader
        title="Safe pay payouts"
        description="Sellers' Safe pay sales paid out to bank accounts in their verified name. Set aside while the bank transfer runs; returned only if the bank refused it."
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
    </UdozoShell>
  );
}
