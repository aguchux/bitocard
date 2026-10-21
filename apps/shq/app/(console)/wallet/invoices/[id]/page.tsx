"use client";

import { use, useState } from "react";
import { ActionDialog, Button, Card, CardHeader, type Column, DataTable, errorMessage, formatDate, formatDateTime, formatMoney, Notice, PageHeader, StatusBadge } from "@bitocard/admin-ui";
import { type InvoiceLine, useInvoiceQuery, usePayInvoiceMutation } from "@bitocard/api-client/reseller";
import { ShqShell } from "@/components/shq-shell";
import { can, useReseller } from "@/components/reseller";
import { invoiceStatus, monthName } from "@/components/invoices";

const kindLabels = { subscription: "Plan", domain: "Domain", platform_fee: "BitoCard fee", usage: "Usage" } as const;

/** One invoice with its lines, and Pay invoice (from topped-up funds, then earnings). */
export default function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { membership } = useReseller();
  const invoice = useInvoiceQuery(id);
  const [pay] = usePayInvoiceMutation();
  const [paying, setPaying] = useState(false);
  const data = invoice.data;
  const currency = data?.currency ?? "USD";

  const columns: Array<Column<InvoiceLine>> = [
    { key: "date", header: "Date", hideOnMobile: true, cell: row => formatDateTime(row.created_at) },
    {
      key: "what",
      header: "What",
      cell: row => (
        <span>
          <span className="block text-xs text-muted">{kindLabels[row.kind]}</span>
          {row.description}
        </span>
      ),
    },
    { key: "amount", header: "Amount", align: "right", cell: row => formatMoney(row.amount, currency) },
    { key: "owed", header: "Owed", align: "right", cell: row => formatMoney(row.owed, currency) },
  ];

  return (
    <ShqShell section="wallet" current="/wallet/invoices" crumbs={[{ label: "Wallet", href: "/wallet" }, { label: "Invoices", href: "/wallet/invoices" }, { label: data?.number ?? "Invoice" }]}>
      <PageHeader
        title={data?.number ?? "Invoice"}
        description={data ? `${monthName(data.period_start)} · ${data.currency}` : undefined}
        actions={data && data.owed > 0 && can(membership, "finance") ? <Button onClick={() => setPaying(true)}>Pay invoice</Button> : null}
      />
      {invoice.error ? <Notice tone="red">{errorMessage(invoice.error)}</Notice> : null}
      {data ? (
        <Card>
          <CardHeader
            title={`${formatMoney(data.total, currency)} total · ${formatMoney(data.owed, currency)} owed`}
            description={
              data.owed > 0 && data.due_at
                ? `Due ${formatDate(data.due_at)}. Your next top-up pays it, or pay it now.`
                : data.paid_at
                  ? `Paid ${formatDate(data.paid_at)}.`
                  : "Each charge was taken from your wallet when it happened."
            }
            actions={<StatusBadge {...invoiceStatus(data)} />}
          />
          <div className="mt-4">
            <DataTable caption="Invoice lines" rows={data.lines} rowKey={row => row.id} empty="No charges yet." columns={columns} />
          </div>
        </Card>
      ) : null}
      <ActionDialog
        open={paying}
        onClose={() => setPaying(false)}
        title="Pay this invoice?"
        confirmLabel="Pay now"
        requireReason={false}
        onConfirm={async () => {
          await pay(id).unwrap();
        }}
      >
        <p className="text-sm text-muted">{data ? `${formatMoney(data.owed, currency)} is taken from your live wallet: topped-up funds first, then earnings.` : ""}</p>
      </ActionDialog>
    </ShqShell>
  );
}
