"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { Button, Card, DataTable, errorMessage, formatDateTime, formatMoney, formatRelative, Input, PageHeader, Select, StatusBadge } from "@bitocard/admin-ui";
import { AdminShell, AppLink } from "@bitocard/admin-ui/shell";
import { type FundingSource, type FundingStatus, type Mode, useAdminFundingsQuery } from "@bitocard/api-client/admin";

const sourceNames: Record<FundingSource, string> = {
  gateway: "Payment gateway",
  static_account: "Static account",
  manual: "Manual funding",
  bank_deposit: "Bank deposit",
};

/** Orders > Fundings: every recorded inflow into reseller and customer wallets, regardless of collection channel. */
export default function FundingsPage() {
  const params = useSearchParams();
  const fixedReseller = params.get("reseller_id") || undefined;
  const fixedCustomer = params.get("customer_id") || undefined;
  const [mode, setMode] = useState<Mode>("live");
  const [owner, setOwner] = useState<"" | "reseller" | "customer">(fixedCustomer ? "customer" : fixedReseller ? "reseller" : "");
  const [source, setSource] = useState<"" | FundingSource>("");
  const [status, setStatus] = useState<"" | FundingStatus>("");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const fundings = useAdminFundingsQuery({ mode, owner: owner || undefined, source: source || undefined, status: status || undefined, q: q || undefined, reseller_id: fixedReseller, customer_id: fixedCustomer });

  return (
    <AdminShell section="orders" current="/orders/fundings" crumbs={[{ label: "Orders", href: "/orders" }, { label: "Fundings" }]}>
      <PageHeader title="Fundings" description="Every gateway payment, static-account transfer, bank deposit and manual credit recorded for reseller and customer wallets." />

      <form
        className="grid gap-3 rounded-2xl border border-line bg-white p-4 sm:grid-cols-2 xl:grid-cols-[1fr_repeat(4,auto)]"
        onSubmit={event => {
          event.preventDefault();
          setQ(search.trim());
        }}
      >
        <div className="flex min-w-0 gap-2">
          <Input aria-label="Search fundings" value={search} onChange={event => setSearch(event.target.value)} placeholder="Name, email, reference or account" />
          <Button type="submit" variant="secondary" icon={<Search className="size-4" aria-hidden />}>Search</Button>
        </div>
        <Select aria-label="Owner type" value={owner} disabled={Boolean(fixedReseller || fixedCustomer)} onChange={event => setOwner(event.target.value as typeof owner)}>
          <option value="">All owners</option>
          <option value="reseller">Resellers</option>
          <option value="customer">Customers</option>
        </Select>
        <Select aria-label="Funding source" value={source} onChange={event => setSource(event.target.value as typeof source)}>
          <option value="">All sources</option>
          {Object.entries(sourceNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </Select>
        <Select aria-label="Funding status" value={status} onChange={event => setStatus(event.target.value as typeof status)}>
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="succeeded">Succeeded</option>
          <option value="failed">Failed</option>
        </Select>
        <Select aria-label="Mode" value={mode} onChange={event => setMode(event.target.value as Mode)}>
          <option value="live">Live</option>
          <option value="test">Sandbox</option>
        </Select>
      </form>

      <Card>
        <DataTable
          caption="Wallet fundings"
          rows={fundings.data?.data}
          loading={fundings.isLoading}
          error={fundings.error ? errorMessage(fundings.error) : null}
          onRetry={fundings.refetch}
          rowKey={row => row.id}
          empty="No funding records match these filters."
          columns={[
            {
              key: "owner",
              header: "Owner",
              cell: row => (
                <div className="space-y-0.5">
                  <AppLink href={row.owner.type === "customer" ? `/orders/fundings?customer_id=${row.owner.id}` : `/resellers/${row.owner.id}`} className="font-semibold text-brand-600 hover:underline">{row.owner.name}</AppLink>
                  <p className="text-xs text-muted">{row.owner.type === "customer" ? `Customer${row.owner.email ? ` · ${row.owner.email}` : ""}${row.owner.reseller ? ` · ${row.owner.reseller}` : ""}` : "Reseller"}</p>
                </div>
              ),
            },
            {
              key: "source",
              header: "Source",
              cell: row => (
                <div className="space-y-0.5">
                  <p className="font-medium">{sourceNames[row.source]}</p>
                  <p className="text-xs capitalize text-muted">{row.provider}</p>
                </div>
              ),
            },
            {
              key: "amount",
              header: "Amount",
              cell: row => (
                <div className="space-y-0.5">
                  <p className="font-semibold">{formatMoney(row.amount, row.currency)}</p>
                  {row.credited_amount !== null && row.credited_amount !== row.amount ? <p className="text-xs text-muted">Credited {formatMoney(row.credited_amount, row.currency)}</p> : null}
                </div>
              ),
            },
            {
              key: "status",
              header: "Status",
              cell: row => (
                <div className="space-y-0.5">
                  <StatusBadge status={row.status === "succeeded" ? "active" : row.status} label={row.provider_status.replaceAll("_", " ")} />
                  {row.failure_reason ? <p className="max-w-56 text-xs text-red-700">{row.failure_reason}</p> : null}
                </div>
              ),
            },
            {
              key: "reference",
              header: "Reference / account",
              hideOnMobile: true,
              cell: row => (
                <div className="space-y-0.5">
                  <p className="font-mono text-xs">{row.reference}</p>
                  {row.external_reference ? <p className="font-mono text-xs text-muted">{row.external_reference}</p> : null}
                  {row.static_account ? <p className="text-xs text-muted">{`${row.static_account.bank_name} · ${row.static_account.account_number}`}</p> : null}
                </div>
              ),
            },
            { key: "created", header: "Created", hideOnMobile: true, cell: row => <span title={formatDateTime(row.created_at)}>{formatRelative(row.created_at)}</span> },
          ]}
        />
        {fundings.data?.has_more ? <p className="px-5 py-3 text-xs text-muted">The 100 newest matching records are shown. Narrow the filters to find older funding.</p> : null}
      </Card>
    </AdminShell>
  );
}
