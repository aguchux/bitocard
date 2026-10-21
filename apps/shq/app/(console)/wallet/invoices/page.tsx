"use client";

import { useState } from "react";
import { Gauge, ReceiptText, TrendingUp } from "lucide-react";
import { ActionDialog, Button, Card, CardHeader, type Column, DataTable, errorMessage, formatDate, formatMoney, Notice, PageHeader, StatCard, StatusBadge } from "@bitocard/admin-ui";
import { AppLink } from "@bitocard/admin-ui/shell";
import { type Invoice, useCreditQuery, useInvoicesQuery, useRaiseCreditMutation, useStoresQuery } from "@bitocard/api-client/reseller";
import { ShqShell } from "@/components/shq-shell";
import { can, useReseller } from "@/components/reseller";
import { invoiceStatus, monthName } from "@/components/invoices";

const usd = (cents: number) => formatMoney(cents, "USD");
const blocked = { maximum: "Your credit limit is at its maximum.", owing: "Pay what you owe first.", no_paid_month: "After a full month's invoice is paid in full, you can raise it one step." } as const;

/** Monthly invoices per store and for the account, what is owed, and the credit limit. Live only. */
export default function InvoicesPage() {
  const { membership } = useReseller();
  const invoices = useInvoicesQuery({ limit: 100 });
  const credit = useCreditQuery();
  const stores = useStoresQuery().data?.data ?? [];
  const [raise] = useRaiseCreditMutation();
  const [raising, setRaising] = useState(false);
  const storeName = (id: string | null) => (id ? (stores.find(store => store.id === id)?.name ?? "Store") : "Your account");
  const owed = credit.data?.owed ?? [];

  const columns: Array<Column<Invoice>> = [
    {
      key: "number",
      header: "Invoice",
      cell: row => (
        <AppLink href={`/wallet/invoices/${row.id}`} className="font-semibold text-brand-600 hover:underline">
          {row.number}
        </AppLink>
      ),
    },
    { key: "for", header: "For", cell: row => storeName(row.store_id) },
    { key: "month", header: "Month", hideOnMobile: true, cell: row => monthName(row.period_start) },
    { key: "total", header: "Total", align: "right", cell: row => formatMoney(row.total, row.currency) },
    { key: "owed", header: "Owed", align: "right", cell: row => formatMoney(row.owed, row.currency) },
    { key: "due", header: "Due", hideOnMobile: true, cell: row => (row.due_at && row.owed > 0 ? formatDate(row.due_at) : "—") },
    { key: "status", header: "Status", cell: row => <StatusBadge {...invoiceStatus(row)} /> },
  ];

  return (
    <ShqShell section="wallet" current="/wallet/invoices" crumbs={[{ label: "Wallet", href: "/wallet" }, { label: "Invoices" }]}>
      <PageHeader
        title="Invoices"
        description="A monthly invoice for each store, and one for your account's own usage. Each charge is taken from your live wallet when it happens; what your wallet cannot cover is owed, up to your credit limit, and your next top-up pays it first."
      />
      {credit.error ? <Notice tone="red">{errorMessage(credit.error)}</Notice> : null}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Credit limit"
          value={usd(credit.data?.limit_usd_cents ?? 0)}
          icon={<Gauge aria-hidden />}
          loading={credit.isLoading}
          footer={<p className="text-xs text-muted">At the limit, billable usage stops until what you owe is paid.</p>}
        />
        <StatCard
          label="You owe"
          value={owed.length ? owed.map(item => formatMoney(item.amount, item.currency)).join(" · ") : "Nothing"}
          icon={<ReceiptText aria-hidden />}
          tone={owed.length ? "amber" : "green"}
          loading={credit.isLoading}
        />
        <StatCard
          label="Next step"
          value={credit.data?.next_limit_usd_cents ? usd(credit.data.next_limit_usd_cents) : "Maximum"}
          icon={<TrendingUp aria-hidden />}
          tone="blue"
          loading={credit.isLoading}
          footer={
            credit.data?.can_raise && can(membership, "finance") ? (
              <Button size="sm" onClick={() => setRaising(true)}>
                Raise my limit
              </Button>
            ) : credit.data?.raise_blocked_by ? (
              <p className="text-xs text-muted">{blocked[credit.data.raise_blocked_by]}</p>
            ) : null
          }
        />
      </div>
      <Card>
        <CardHeader title="Your invoices" description="Live mode only. Newest first." />
        <div className="mt-4">
          <DataTable
            caption="Invoices"
            rows={invoices.data?.data}
            loading={invoices.isLoading}
            error={invoices.error ? errorMessage(invoices.error) : null}
            onRetry={invoices.refetch}
            rowKey={row => row.id}
            empty="No invoices yet. Your first one starts with your first charge."
            columns={columns}
          />
        </div>
      </Card>
      <ActionDialog
        open={raising}
        onClose={() => setRaising(false)}
        title="Raise your credit limit?"
        confirmLabel="Raise it"
        requireReason={false}
        onConfirm={async () => {
          await raise().unwrap();
        }}
      >
        <p className="text-sm text-muted">{`Your credit limit goes up to ${usd(credit.data?.next_limit_usd_cents ?? 0)}. Anything you owe is still paid by your next top-up, and is due 7 days after its invoice closes.`}</p>
      </ActionDialog>
    </ShqShell>
  );
}
