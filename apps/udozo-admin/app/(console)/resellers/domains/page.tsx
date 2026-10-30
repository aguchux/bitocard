"use client";

import { useState } from "react";
import { ActionDialog, Button, Card, type Column, DataTable, errorMessage, formatDate, formatRelative, Input, PageHeader, StatusBadge, Tabs, useDebouncedValue } from "@bitocard/admin-ui";
import { AppLink, can, useAdmin } from "@bitocard/admin-ui/shell";
import { UdozoShell } from "@/components/shell";
import { type AdminStoreDomain, useAdminDomainsQuery, useReinstateDomainMutation, useSuspendDomainMutation } from "@bitocard/api-client/admin";

type Filter = "" | "active" | "pending" | "purchasing" | "expired" | "suspended" | "failed";
const statusLabels: Record<string, string> = { purchasing: "Buying", pending: "Waiting for DNS", active: "Live", failed: "Not bought", expired: "Expired", suspended: "Suspended", removed: "Removed" };
const usd = (cents: number) => `US$${(cents / 100).toFixed(2)}`;

/** Resellers' store domains: bought through Udozo or connected; operations suspend one (abuse, disputes) and reinstate it. */
export default function DomainsPage() {
  const admin = useAdmin();
  const decides = can(admin, "operations");
  const [status, setStatus] = useState<Filter>("");
  const [search, setSearch] = useState("");
  const q = useDebouncedValue(search.trim());
  const { data, error, isLoading, refetch } = useAdminDomainsQuery({ status: status || undefined, q: q || undefined });
  const [suspend] = useSuspendDomainMutation();
  const [reinstate] = useReinstateDomainMutation();
  const [pending, setPending] = useState<{ row: AdminStoreDomain; action: "suspend" | "reinstate" } | null>(null);

  const columns: Array<Column<AdminStoreDomain>> = [
    {
      key: "domain",
      header: "Domain",
      cell: row => (
        <span className="block min-w-0">
          <a href={row.url} target="_blank" rel="noreferrer" className="break-all font-semibold text-ink hover:underline">{row.name}</a>
          <span className="block text-sm text-muted">{row.source === "purchased" ? "Bought through Udozo" : "Connected"}{row.primary ? " · main address" : ""}</span>
        </span>
      ),
    },
    {
      key: "store",
      header: "Store",
      cell: row => (
        <span className="block min-w-0">
          <AppLink href={`/resellers/${row.reseller.id}`} className="font-semibold text-ink hover:underline">{row.reseller.name}</AppLink>
          <span className="block text-sm text-muted">{row.store.subdomain}.udozo.com</span>
        </span>
      ),
    },
    { key: "dns", header: "DNS", hideOnMobile: true, cell: row => (row.dns_mode === "vercel" ? "Vercel" : "Reseller’s host") },
    { key: "money", header: "Paid / cost", hideOnMobile: true, cell: row => (row.price && row.cost ? `${usd(row.price.amount)} / ${usd(row.cost.amount)}` : "—") },
    { key: "expires", header: "Expires", hideOnMobile: true, cell: row => (row.expires_at ? formatDate(row.expires_at) : "—") },
    { key: "status", header: "Status", cell: row => <StatusBadge status={row.status === "pending" ? "pending" : row.status} label={statusLabels[row.status] ?? row.status} /> },
    { key: "checked", header: "Checked", hideOnMobile: true, cell: row => formatRelative(row.last_checked_at) },
    {
      key: "actions",
      header: "",
      align: "right",
      cell: row =>
        decides && ["active", "pending", "expired"].includes(row.status) ? (
          <Button size="sm" variant="ghost" onClick={() => setPending({ row, action: "suspend" })}>Suspend</Button>
        ) : decides && row.status === "suspended" ? (
          <Button size="sm" variant="secondary" onClick={() => setPending({ row, action: "reinstate" })}>Reinstate</Button>
        ) : null,
    },
  ];

  return (
    <UdozoShell section="resellers" current="/resellers/domains" crumbs={[{ label: "Resellers", href: "/resellers" }, { label: "Domains" }]}>
      <PageHeader
        title="Store domains"
        description="Resellers' own domains: bought through Udozo (Vercel's price plus the margin set in Settings > Integrations > Domains) or connected from another registrar."
        actions={
          <div className="w-64 max-w-full">
            <label htmlFor="domain-search" className="sr-only">Search domains</label>
            <Input id="domain-search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search domains" />
          </div>
        }
      />
      <Tabs
        label="Domain status"
        value={status}
        onChange={setStatus}
        items={[{ value: "", label: "All" }, ...(["active", "pending", "purchasing", "expired", "suspended", "failed"] as const).map(value => ({ value, label: statusLabels[value] }))]}
      />
      <Card>
        <DataTable columns={columns} rows={data?.data} rowKey={row => row.id} loading={isLoading} error={error ? errorMessage(error) : null} onRetry={refetch} empty="No domains here." caption="Store domains" />
      </Card>
      {pending ? (
        <ActionDialog
          open
          onClose={() => setPending(null)}
          title={pending.action === "suspend" ? `Suspend ${pending.row.name}?` : `Reinstate ${pending.row.name}?`}
          description={
            pending.action === "suspend"
              ? "The store stops being served on it at once and the reseller is told. The domain stays registered to them. Your reason is kept in the audit log."
              : "The store is served on it again once its DNS checks out."
          }
          confirmLabel={pending.action === "suspend" ? "Suspend" : "Reinstate"}
          tone={pending.action === "suspend" ? "danger" : "primary"}
          onConfirm={reason => (pending.action === "suspend" ? suspend({ id: pending.row.id, reason }) : reinstate({ id: pending.row.id, reason })).unwrap()}
        />
      ) : null}
    </UdozoShell>
  );
}
