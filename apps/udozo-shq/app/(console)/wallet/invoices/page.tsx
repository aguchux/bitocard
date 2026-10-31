"use client";

import { usePaidPlans, walletPaysFor } from "@/components/paid-plans";
import { ReceiptText } from "lucide-react";
import { Card, CardHeader, type Column, DataTable, errorMessage, formatDate, formatMoney, Notice, PageHeader, StatCard, StatusBadge } from "@bitocard/admin-ui";
import { AppLink } from "@bitocard/admin-ui/shell";
import { type Invoice, useCreditQuery, useInvoicesQuery, useStoresQuery } from "@bitocard/api-client/reseller";
import { ShqShell } from "@/components/shq-shell";
import { invoiceStatus, monthName } from "@/components/invoices";

/** Monthly invoices per store and for the account (domains, and Premium and the setup fee where charged), and what is owed. Live only. */
export default function InvoicesPage() {
  const paidPlans = usePaidPlans();
  const invoices = useInvoicesQuery({ limit: 100 });
  const credit = useCreditQuery();
  const stores = useStoresQuery().data?.data ?? [];
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
        description={`A monthly invoice for each store, and one for your account. Each charge (${walletPaysFor(paidPlans)}) is taken from your live wallet when it happens; anything your wallet could not cover is owed, and your next top-up pays it first.`}
      />
      {credit.error ? <Notice tone="red">{errorMessage(credit.error)}</Notice> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard
          label="You owe"
          value={owed.length ? owed.map(item => formatMoney(item.amount, item.currency)).join(" · ") : "Nothing"}
          icon={<ReceiptText aria-hidden />}
          tone={owed.length ? "amber" : "green"}
          loading={credit.isLoading}
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
    </ShqShell>
  );
}
