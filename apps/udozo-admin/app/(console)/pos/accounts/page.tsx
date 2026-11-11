"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Card, DataTable, errorMessage, FilterSelect, formatDate, Input, PageHeader, useDebouncedValue, type Column } from "@bitocard/admin-ui";
import { usePrefetchQuery } from "@bitocard/api-client";
import { type AdminPosAccount, type PosPlanCode, posAccountStatusLabels, posPlanCodes, usePosAccountsQuery } from "@bitocard/api-client/admin";
import { MarketFilter } from "@/components/classifieds";
import { accountState, posStatusTones } from "@/components/pos";
import { UdozoShell } from "@/components/shell";

const planLabels: Record<PosPlanCode, string> = { free: "Free", premium: "Premium", multi_shop: "Multi-shop" };

/** POS > Accounts: every shop owner's Udozo POS account, newest first, found by shop, shop code, name or email. */
export default function PosAccountsPage() {
  const router = useRouter();
  const prefetch = usePrefetchQuery("posAccount");
  const [q, setQ] = useState("");
  const [country, setCountry] = useState("");
  const [plan, setPlan] = useState<PosPlanCode | "">("");
  const search = useDebouncedValue(q.trim());
  const accounts = usePosAccountsQuery({ q: search || undefined, country: country || undefined, plan: plan || undefined });

  const columns: Array<Column<AdminPosAccount>> = [
    {
      key: "shop",
      header: "Shop",
      cell: row => (
        <span className="block min-w-0">
          <span className="block truncate font-semibold text-brand-600">{row.shops.map(shop => shop.name).join(", ") || "No shop"}</span>
          <span className="block truncate text-xs text-muted">
            {row.shops.map(shop => shop.shop_code).join(", ")} · {row.country}
          </span>
        </span>
      ),
    },
    {
      key: "owner",
      header: "Owner",
      hideOnMobile: true,
      cell: row => (
        <span className="block min-w-0">
          <span className="block truncate font-medium text-ink">{row.owner.name}</span>
          <span className="block truncate text-xs text-muted">{row.owner.email}</span>
        </span>
      ),
    },
    {
      key: "plan",
      header: "Plan",
      cell: row => (
        <span className="grid gap-1">
          <Badge tone={posStatusTones[row.status]}>
            {row.plan.name} · {posAccountStatusLabels[row.status]}
          </Badge>
          <span className="text-xs text-muted">{accountState(row)}</span>
        </span>
      ),
    },
    { key: "since", header: "Since", hideOnMobile: true, cell: row => <span className="whitespace-nowrap text-sm text-muted">{formatDate(row.created_at)}</span> },
  ];

  return (
    <UdozoShell section="pos" current="/pos/accounts" crumbs={[{ label: "POS", href: "/pos/accounts" }, { label: "Accounts" }]}>
      <PageHeader title="Udozo POS accounts" description="Shop owners using pos.udozo.com, with their plan, shops and tills. Open one to see its charges." />
      <div className="mt-6 flex flex-wrap items-end gap-3">
        <label className="grid min-w-0 gap-1 text-sm font-medium text-ink sm:w-72">
          Find
          <Input value={q} onChange={event => setQ(event.target.value)} placeholder="Shop, shop code, name or email" />
        </label>
        <MarketFilter id="pos-market" value={country} onChange={setCountry} />
        <FilterSelect id="pos-plan" label="Plan" value={plan} onChange={value => setPlan(value as PosPlanCode | "")} options={[{ value: "", label: "All plans" }, ...posPlanCodes.map(code => ({ value: code, label: planLabels[code] }))]} />
      </div>
      <Card className="mt-4">
        <DataTable<AdminPosAccount>
          caption="Udozo POS accounts"
          columns={columns}
          rows={accounts.data?.data}
          loading={accounts.isLoading}
          error={accounts.error ? errorMessage(accounts.error) : null}
          onRetry={accounts.refetch}
          rowKey={row => row.id}
          onRowClick={row => router.push(`/pos/accounts/${row.id}`)}
          onRowIntent={row => {
            router.prefetch(`/pos/accounts/${row.id}`);
            prefetch(row.id);
          }}
          empty={search || country || plan ? "No accounts match." : "No shop has signed up for Udozo POS yet."}
        />
      </Card>
      {accounts.data && accounts.data.total > accounts.data.data.length ? <p className="mt-3 text-sm text-muted">Showing the newest {accounts.data.data.length} of {accounts.data.total}. Narrow the search to find others.</p> : null}
    </UdozoShell>
  );
}
