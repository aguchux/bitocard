"use client";

import { useState } from "react";
import { CalendarDays, Percent, ReceiptText } from "lucide-react";
import { Card, CardHeader, type Column, DataTable, errorMessage, Field, formatDateTime, formatMoney, Input, Notice, PageHeader, StatCard, StatusBadge } from "@bitocard/admin-ui";
import { type FeeCharge, useFeeChargesQuery, useFeeRatesQuery, useFeeStatementQuery } from "@bitocard/api-client/reseller";
import { ShqShell } from "@/components/shq-shell";
import { useReseller } from "@/components/reseller";

const kindLabels = { supplier_order: "Orders through your own suppliers", gateway_payment: "Payments through your own gateway" } as const;
const statusLabels = { held: "Held", charged: "Charged", released: "Not charged", refunded: "Refunded" } as const;
const thisMonth = () => new Date().toISOString().slice(0, 7);

/** A carried fraction (billionths of a minor unit) as a share of one unit, for example "0.5". */
function fraction(nano: string | null) {
  if (!nano || nano === "0") return "0";
  return `0.${nano.padStart(9, "0").replace(/0+$/, "")}`;
}

/**
 * BitoCard's fees on your own-integration transactions: a monthly statement (fees and subscription), the rates that
 * apply to you, and every fee with its exact amount and the fraction carried to your next transaction.
 */
export default function FeesPage() {
  const { mode } = useReseller();
  const [month, setMonth] = useState(thisMonth);
  const statement = useFeeStatementQuery(month);
  const charges = useFeeChargesQuery({ month, limit: 100 });
  const rates = useFeeRatesQuery();
  const currency = statement.data?.currency ?? "USD";
  const charged = rates.data?.data.filter(rate => rate.rate_ppb > 0 || rate.min_fee) ?? [];

  const columns: Array<Column<FeeCharge>> = [
    { key: "date", header: "Date", cell: row => formatDateTime(row.created_at) },
    { key: "kind", header: "On", cell: row => `${row.source.type === "payment" ? "Payment" : "Order"} ${row.source.id.slice(0, 8)}`, hideOnMobile: true },
    { key: "base", header: "Amount", align: "right", cell: row => formatMoney(row.base, row.currency) },
    { key: "rate", header: "Rate", align: "right", cell: row => `${row.rate_percent}%` },
    { key: "charged", header: "Fee charged", align: "right", cell: row => (row.charged === null ? "—" : formatMoney(row.charged, row.currency)) },
    { key: "carried", header: "Carried", align: "right", hideOnMobile: true, cell: row => (row.carry_after_nano === null ? "—" : `${fraction(row.carry_after_nano)} unit`) },
    { key: "status", header: "Status", cell: row => <StatusBadge status={row.status === "charged" ? "completed" : row.status} label={statusLabels[row.status]} /> },
  ];

  return (
    <ShqShell section="wallet" current="/wallet/fees" crumbs={[{ label: "Wallet", href: "/wallet" }, { label: "BitoCard fees" }]}>
      <PageHeader
        title="BitoCard fees"
        description="BitoCard charges a small fee on orders through your own suppliers and payments through your own gateway, from your wallet. Each fee is exact: fractions of a unit are carried to your next transaction, never rounded up."
        actions={
          <Field label="Month" htmlFor="fee-month">
            <Input id="fee-month" type="month" value={month} max={thisMonth()} onChange={event => event.target.value && setMonth(event.target.value)} className="w-44" />
          </Field>
        }
      />
      {statement.error ? <Notice tone="red">{errorMessage(statement.error)}</Notice> : null}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Fees" value={formatMoney(statement.data?.fees.net ?? 0, currency)} icon={<Percent aria-hidden />} loading={statement.isLoading} footer={<p className="text-xs text-muted">{`${statement.data?.fees.transactions ?? 0} transactions${mode === "test" ? " · sandbox" : ""}`}</p>} />
        <StatCard label="Subscription" value={formatMoney(statement.data?.subscription ?? 0, currency)} icon={<CalendarDays aria-hidden />} tone="blue" loading={statement.isLoading} />
        <StatCard
          label="Total for the month"
          value={formatMoney(statement.data?.total ?? 0, currency)}
          icon={<ReceiptText aria-hidden />}
          tone="green"
          loading={statement.isLoading}
          footer={<p className="text-xs text-muted">{`Carried to next: ${fraction(statement.data?.carried_nano ?? null)} unit`}</p>}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader title="Fees this month" description="Every fee with its rate, what was charged and the fraction carried." />
          <DataTable
            columns={columns}
            rows={charges.data?.data}
            rowKey={row => row.id}
            loading={charges.isLoading}
            error={charges.error ? errorMessage(charges.error) : null}
            onRetry={charges.refetch}
            empty="No fees this month."
            caption="BitoCard fees"
          />
        </Card>
        <Card>
          <CardHeader title="Your rates" description="For your country and plan." />
          <div className="space-y-2 px-5 pb-5 text-sm sm:px-6">
            {rates.isLoading ? null : charged.length === 0 ? (
              <p className="text-muted">No fees apply to your account yet.</p>
            ) : (
              charged.map(rate => (
                <div key={`${rate.kind}-${rate.category ?? "all"}`} className="flex flex-wrap justify-between gap-2">
                  <span className="text-muted">
                    {kindLabels[rate.kind]}
                    {rate.category ? ` · ${rate.category.replace("_", " ")}` : ""}
                  </span>
                  <span className="font-semibold text-ink">
                    {`${rate.rate_percent}%`}
                    {rate.min_fee ? ` (min ${formatMoney(rate.min_fee, rate.currency ?? currency)})` : ""}
                  </span>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>
    </ShqShell>
  );
}
