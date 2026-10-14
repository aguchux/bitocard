"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Coins, DollarSign, Gift, Users } from "lucide-react";
import { Card, DataTable, errorMessage, FilterSelect, formatDateTime, PageHeader, StatCard, type Column } from "@bitocard/admin-ui";
import { AdminShell, AppLink } from "@bitocard/admin-ui/shell";
import { type Mode, type SpinReward, useSpinRewardsQuery } from "@bitocard/api-client/admin";

const dollars = (value: string) => `$${Number(value).toFixed(2)}`;

/** A crypto amount without trailing zeros ("0.000081"). */
const coins = (amount: string) => (amount.includes(".") ? amount.replace(/\.?0+$/, "") : amount);

const columns: Array<Column<SpinReward>> = [
  {
    key: "customer",
    header: "Customer",
    cell: spin => (
      <AppLink href={`/crypto/customers/${spin.customer.id}`} className="text-brand-600 hover:underline">
        {spin.customer.email}
      </AppLink>
    ),
  },
  {
    key: "won",
    header: "Won",
    cell: spin => (
      <span className="block">
        <span className="block font-semibold text-ink">
          {coins(spin.amount)} {spin.asset}
        </span>
        <span className="block text-xs text-muted">{dollars(spin.usd)}</span>
      </span>
    ),
  },
  { key: "number", header: "Spin", cell: spin => `#${spin.number}` },
  { key: "date", header: "Date", hideOnMobile: true, cell: spin => formatDateTime(spin.created_at) },
];

/** Crypto > Spin rewards: every customer's one-time $1, won spin by spin and paid into their crypto wallet. */
export default function SpinRewardsPage() {
  // useSearchParams needs a Suspense boundary (a customer's page links here with ?customer=<id>).
  return (
    <Suspense>
      <SpinRewards />
    </Suspense>
  );
}

function SpinRewards() {
  const customer = useSearchParams().get("customer") ?? undefined;
  const [mode, setMode] = useState<Mode>("live");
  const spins = useSpinRewardsQuery({ mode, ...(customer ? { customer_id: customer } : {}) });
  const totals = (spins.data?.totals ?? []).filter(total => total.mode === mode);
  const usdTotal = totals.reduce((sum, total) => sum + Number(total.usd), 0);
  const spinCount = totals.reduce((sum, total) => sum + total.spins, 0);
  return (
    <AdminShell section="crypto" current="/crypto/spins" crumbs={[{ label: "Crypto", href: "/crypto" }, { label: "Spin rewards" }]}>
      <PageHeader
        title="Spin rewards"
        description="The Spin and win promotion: $1 per person, once, paid in crypto over 50 to 100 spins (up to 5 a day). Each spin is decided by the API and paid into the customer's crypto wallet at once."
      />
      <div className="mt-6 flex flex-wrap gap-3">
        <FilterSelect id="spins-mode" label="Mode" value={mode} onChange={value => setMode(value as Mode)} options={[{ value: "live", label: "Live" }, { value: "test", label: "Test" }]} />
        {customer ? (
          <AppLink href="/crypto/spins" className="self-end pb-2 text-sm text-brand-600 hover:underline">
            Show every customer
          </AppLink>
        ) : null}
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={<DollarSign />} label="Paid out" value={dollars(String(usdTotal))} loading={spins.isLoading} />
        <StatCard icon={<Gift />} tone="blue" label="Spins" value={spinCount.toLocaleString("en-GB")} loading={spins.isLoading} />
        <StatCard icon={<Users />} tone="green" label="Customers started" value={(spins.data?.customers ?? 0).toLocaleString("en-GB")} loading={spins.isLoading} />
        {totals.map(total => (
          <StatCard
            key={total.asset}
            icon={<Coins />}
            tone="amber"
            label={total.asset}
            value={`${coins(total.amount)} ${total.asset}`}
            footer={
              <span className="text-xs text-muted">
                {dollars(total.usd)} · {total.spins.toLocaleString("en-GB")} spins
              </span>
            }
          />
        ))}
      </div>
      <Card className="mt-4">
        <DataTable columns={columns} rows={spins.data?.data} rowKey={spin => spin.id} loading={spins.isLoading} error={spins.error ? errorMessage(spins.error) : null} onRetry={spins.refetch} empty="No spins yet." />
      </Card>
    </AdminShell>
  );
}
