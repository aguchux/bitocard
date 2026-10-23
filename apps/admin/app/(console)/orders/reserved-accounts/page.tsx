"use client";

import { useState } from "react";
import { RefreshCw, Search } from "lucide-react";
import { Button, Card, DataTable, errorMessage, formatDateTime, formatRelative, Input, Notice, PageHeader, Select, StatusBadge, Tabs } from "@bitocard/admin-ui";
import { AdminShell, can, useAdmin } from "@bitocard/admin-ui/shell";
import { type Mode, type ReservedAccountRequestStatus, useReservedAccountsQuery, useSweepReservedDepositsMutation } from "@bitocard/api-client/admin";

const filters = [
  { value: "pending", label: "Waiting for the bank" },
  { value: "refused", label: "Refused" },
  { value: "active", label: "Open" },
  { value: "all", label: "All" },
] as const;

type Filter = (typeof filters)[number]["value"];

const statusLabels: Record<ReservedAccountRequestStatus, string> = { pending: "Waiting", active: "Open", refused: "Refused" };

/**
 * Orders > Bank transfer accounts: every wallet's static bank account numbers (Flutterwave, Monnify) and each request
 * to open them. A request waiting for the bank had no clear answer: the bank may have opened the account, and
 * transfers into it are still credited by its reference. Check now credits any transfer whose notification never came.
 */
export default function ReservedAccountsPage() {
  const admin = useAdmin();
  const [filter, setFilter] = useState<Filter>("pending");
  const [mode, setMode] = useState<Mode>("live");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const accounts = useReservedAccountsQuery({ mode, status: filter === "all" ? undefined : filter, q: q || undefined });
  const [sweep, sweepState] = useSweepReservedDepositsMutation();
  const swept = sweepState.data;

  return (
    <AdminShell section="orders" current="/orders/reserved-accounts" crumbs={[{ label: "Orders", href: "/orders" }, { label: "Bank transfer accounts" }]}>
      <PageHeader
        title="Bank transfer accounts"
        description="Static bank account numbers that top up wallets by transfer. Transfers are credited by their reference, even into an account whose number never reached BitoCard."
        actions={
          can(admin, "finance", "operations") ? (
            <Button variant="secondary" icon={<RefreshCw className="size-4" aria-hidden />} loading={sweepState.isLoading} onClick={() => sweep()}>
              Check for missed transfers
            </Button>
          ) : null
        }
      />
      {sweepState.error ? <Notice tone="red">{errorMessage(sweepState.error)}</Notice> : null}
      {swept ? (
        <Notice tone={swept.error || swept.failed ? "amber" : "green"}>
          {swept.skipped
            ? "Flutterwave is not set up for live payments, so there is nothing to check."
            : swept.error
              ? "Flutterwave's transactions could not be read. Try again shortly."
              : `Checked ${swept.checked ?? 0} transfer${swept.checked === 1 ? "" : "s"} not yet credited: ${swept.credited ?? 0} credited${swept.failed ? `, ${swept.failed} could not be read` : ""}.`}
        </Notice>
      ) : null}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <Tabs label="Show" value={filter} onChange={setFilter} items={filters.map(item => ({ value: item.value, label: item.label }))} />
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={event => {
            event.preventDefault();
            setQ(search.trim());
          }}
        >
          <label htmlFor="reserved-search" className="sr-only">
            Account number, reference, name or email
          </label>
          <Input id="reserved-search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Account number, name or email" className="w-64 max-w-full" />
          <Button type="submit" variant="secondary" icon={<Search className="size-4" aria-hidden />}>
            Search
          </Button>
          <Select value={mode} onChange={event => setMode(event.target.value as Mode)} className="w-auto" aria-label="Mode">
            <option value="live">Live</option>
            <option value="test">Sandbox</option>
          </Select>
        </form>
      </div>

      <Card>
        <DataTable
          caption="Bank transfer accounts"
          rows={accounts.data?.data}
          loading={accounts.isLoading}
          error={accounts.error ? errorMessage(accounts.error) : null}
          onRetry={accounts.refetch}
          rowKey={row => row.id}
          empty={filter === "pending" ? "Nothing is waiting for the bank." : "No accounts here."}
          columns={[
            {
              key: "owner",
              header: "Wallet",
              cell: row => (
                <div className="space-y-0.5">
                  <span className="font-medium text-ink">{row.owner.name ?? "Unknown"}</span>
                  <p className="text-xs text-muted">{row.owner.type === "customer" ? `Customer${row.owner.email ? ` · ${row.owner.email}` : ""}${row.owner.seller ? ` · ${row.owner.seller}` : ""}` : "Reseller"}</p>
                </div>
              ),
            },
            {
              key: "accounts",
              header: "Account numbers",
              cell: row =>
                row.accounts.length ? (
                  <ul className="space-y-0.5">
                    {row.accounts.map(account => (
                      <li key={account.id}>
                        <span className="font-mono text-sm">{account.account_number}</span> <span className="text-xs text-muted">{`${account.bank_name} · ${account.account_name}`}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className="text-xs text-muted">No number received</span>
                ),
            },
            { key: "provider", header: "Provider", hideOnMobile: true, cell: row => <span className="capitalize">{`${row.provider} · ${row.currency}`}</span> },
            {
              key: "status",
              header: "Status",
              cell: row => (
                <div className="space-y-0.5">
                  <StatusBadge status={row.status === "active" ? "active" : row.status === "refused" ? "failed" : "pending"} label={statusLabels[row.status]} />
                  {row.last_error ? <p className="max-w-xs text-xs text-muted">{row.last_error}</p> : null}
                  <p className="text-xs text-subtle">{`${row.attempts} attempt${row.attempts === 1 ? "" : "s"}`}</p>
                </div>
              ),
            },
            { key: "reference", header: "Reference", hideOnMobile: true, cell: row => <span className="font-mono text-xs text-muted">{row.reference}</span> },
            { key: "updated", header: "Updated", hideOnMobile: true, cell: row => <span title={formatDateTime(row.updated_at)}>{formatRelative(row.updated_at)}</span> },
          ]}
        />
        {accounts.data?.has_more ? <p className="px-5 py-3 text-xs text-muted">The 100 most recent are shown. Search to find others.</p> : null}
      </Card>
    </AdminShell>
  );
}
