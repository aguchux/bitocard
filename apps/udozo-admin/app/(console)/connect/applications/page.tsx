"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, DataTable, errorMessage, formatDate, formatNumber, Input, PageHeader, Tabs, type Column } from "@bitocard/admin-ui";
import { AppLink } from "@bitocard/admin-ui/shell";
import { usePrefetchQuery } from "@bitocard/api-client";
import { type ConnectApplicationListItem, type ConnectApplicationStatus, useConnectApplicationsQuery } from "@bitocard/api-client/admin";
import { MarketFilter } from "@/components/classifieds";
import { ApplicationStatus } from "@/components/connect";
import { UdozoShell } from "@/components/shell";

const pageSize = 50;
const filters = [
  { value: "submitted", label: "Submitted" },
  { value: "changes_requested", label: "Changes requested" },
  { value: "visit_scheduled", label: "Visit scheduled" },
  { value: "visited", label: "Visited" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "withdrawn", label: "Withdrawn" },
  { value: "all", label: "All" },
] as const;
type Filter = (typeof filters)[number]["value"];

/**
 * Connect > Applications: people applying to run a Connect Centre, oldest submitted first, by where they stand. Each
 * opens to review it online, ask for changes, schedule and record the visit, then approve or reject it.
 */
export default function ConnectApplicationsPage() {
  const router = useRouter();
  const prefetch = usePrefetchQuery("connectApplication");
  const [filter, setFilter] = useState<Filter>("submitted");
  const [country, setCountry] = useState("");
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const query = useConnectApplicationsQuery({
    status: filter === "all" ? undefined : (filter as ConnectApplicationStatus),
    country: country || undefined,
    q: q.trim() || undefined,
    limit: pageSize,
    offset,
  });
  const total = query.data?.total ?? 0;

  const columns: Array<Column<ConnectApplicationListItem>> = [
    {
      key: "application",
      header: "Application",
      cell: row => (
        <span className="block min-w-0">
          <AppLink href={`/connect/applications/${row.id}`} className="block truncate font-semibold text-brand-600 hover:underline">
            {row.business_name ?? "No business name yet"}
          </AppLink>
          <span className="block truncate text-xs text-muted">
            {row.number} · {[row.area?.name, row.state?.name].filter(Boolean).join(", ") || "No office yet"}
          </span>
        </span>
      ),
    },
    {
      key: "applicant",
      header: "Applicant",
      hideOnMobile: true,
      cell: row =>
        row.applicant ? (
          <span className="block min-w-0">
            <span className="block truncate font-medium text-ink">{row.applicant.name}</span>
            <span className="block truncate text-xs text-muted">{row.applicant.email}</span>
          </span>
        ) : (
          <span className="text-muted">Unknown</span>
        ),
    },
    { key: "submitted", header: "Submitted", hideOnMobile: true, cell: row => <span className="whitespace-nowrap text-muted">{formatDate(row.submitted_at)}</span> },
    { key: "status", header: "Status", cell: row => <ApplicationStatus status={row.status} /> },
  ];

  const changeFilter = (value: Filter) => {
    setFilter(value);
    setOffset(0);
  };

  return (
    <UdozoShell section="connect" current="/connect/applications" crumbs={[{ label: "Connect", href: "/connect/applications" }, { label: "Applications" }]}>
      <PageHeader title="Connect Centre applications" description="Offices applying to receive, check and hand over items for UdozoPay orders. Review each online, visit the office, then approve or reject it." />
      <Tabs label="Show" value={filter} onChange={changeFilter} items={filters.map(item => ({ value: item.value, label: item.label }))} />
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <MarketFilter
          id="connect-market"
          value={country}
          onChange={value => {
            setCountry(value);
            setOffset(0);
          }}
        />
      </div>
      <Card className="mt-4">
        <div className="border-b border-line p-4">
          <label htmlFor="connect-search" className="sr-only">
            Search by number, business, name or email
          </label>
          <Input
            id="connect-search"
            type="search"
            placeholder="Search by CA-000123, business, name or email"
            value={q}
            onChange={event => {
              setQ(event.target.value);
              setOffset(0);
            }}
          />
        </div>
        <DataTable<ConnectApplicationListItem>
          caption="Connect Centre applications"
          columns={columns}
          rows={query.isLoading ? undefined : query.data?.data}
          loading={query.isLoading}
          error={query.error ? errorMessage(query.error) : null}
          onRetry={query.refetch}
          rowKey={row => row.id}
          onRowClick={row => router.push(`/connect/applications/${row.id}`)}
          onRowIntent={row => {
            router.prefetch(`/connect/applications/${row.id}`);
            prefetch(row.id);
          }}
          empty={filter === "submitted" ? "No applications waiting for review." : "No applications."}
        />
      </Card>
      {total > pageSize ? (
        <div className="mt-4 flex items-center justify-between gap-3 text-sm text-muted">
          <span>
            {offset + 1} to {Math.min(offset + pageSize, total)} of {formatNumber(total)}
          </span>
          <span className="flex gap-2">
            <Button size="sm" variant="ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - pageSize))}>
              Previous
            </Button>
            <Button size="sm" variant="ghost" disabled={offset + pageSize >= total} onClick={() => setOffset(offset + pageSize)}>
              Next
            </Button>
          </span>
        </div>
      ) : null}
    </UdozoShell>
  );
}
