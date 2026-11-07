"use client";

import { useState } from "react";
import { ActionDialog, Badge, Button, Card, DataTable, errorMessage, FilterSelect, formatDateTime, formatNumber, Input, PageHeader, type Column } from "@bitocard/admin-ui";
import { can, useAdmin } from "@bitocard/admin-ui/shell";
import { type AdminWantedRequest, type WantedStatus, useRemoveWantedRequestMutation, useWantedRequestsQuery, wantedStatuses } from "@bitocard/api-client/admin";
import { MarketFilter, PersonCell } from "@/components/classifieds";
import { UdozoShell } from "@/components/shell";

const pageSize = 50;
const statusLabels: Record<WantedStatus, string> = { open: "Open", fulfilled: "Found it", closed: "Closed", expired: "Ended", removed: "Removed" };
const statusTones: Record<WantedStatus, "green" | "blue" | "grey" | "amber" | "red"> = { open: "green", fulfilled: "blue", closed: "grey", expired: "amber", removed: "red" };

/**
 * Marketplace > Wanted requests: what buyers asked for (on udozo.com or WhatsApp), how many sellers Udozo told and how
 * many answered, newest first; operations remove one that breaks the rules (the reason audited).
 */
export default function WantedRequestsPage() {
  const admin = useAdmin();
  const [status, setStatus] = useState<WantedStatus | "">("");
  const [country, setCountry] = useState("");
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const requests = useWantedRequestsQuery({ status: status || undefined, country: country || undefined, q: q.trim() || undefined, limit: pageSize, offset });
  const [remove] = useRemoveWantedRequestMutation();
  const [removing, setRemoving] = useState<AdminWantedRequest | null>(null);
  const total = requests.data?.total ?? 0;

  const columns: Array<Column<AdminWantedRequest>> = [
    {
      key: "request",
      header: "Request",
      cell: row => (
        <span className="block min-w-0">
          <span className="block font-semibold text-ink">{row.words}</span>
          <span className="block truncate text-xs text-muted">
            {row.number} · {[row.category.name, row.place, row.budget.text].filter(Boolean).join(" · ")}
          </span>
          {row.details ? <span className="block truncate text-xs text-muted">“{row.details}”</span> : null}
        </span>
      ),
    },
    { key: "buyer", header: "Buyer", hideOnMobile: true, cell: row => <PersonCell person={row.buyer} /> },
    {
      key: "reach",
      header: "Sellers",
      align: "right",
      cell: row => (
        <span className="block whitespace-nowrap text-sm">
          <span className="block font-semibold text-ink">{formatNumber(row.responses)} answered</span>
          <span className="block text-xs text-muted">{formatNumber(row.sellers_told)} told</span>
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: row => (
        <span className="grid gap-1">
          <Badge tone={statusTones[row.status]}>{statusLabels[row.status]}</Badge>
          <span className="text-xs text-muted">
            {row.source === "whatsapp" ? "WhatsApp · " : ""}
            {formatDateTime(row.created_at)}
          </span>
        </span>
      ),
    },
    ...(can(admin, "operations")
      ? [{ key: "remove", header: "", cell: (row: AdminWantedRequest) => (row.status === "removed" ? null : <Button size="sm" variant="ghost" onClick={() => setRemoving(row)}>Remove</Button>) }]
      : []),
  ];

  return (
    <UdozoShell section="marketplace" current="/classifieds/wanted" crumbs={[{ label: "Marketplace", href: "/classifieds" }, { label: "Wanted requests" }]}>
      <PageHeader
        title="Wanted requests"
        description="Buyers say what they need; Udozo shows matching listings and tells sellers with live listings in that category (nearest first, each once, within the market's limits on Limits and words), who answer with a listing in a chat. Each lasts 14 days. Needs the classifieds_wanted switch."
      />
      <div className="mt-6 flex flex-wrap items-end gap-3">
        <FilterSelect
          id="wanted-status"
          label="Status"
          value={status}
          onChange={value => {
            setStatus(value as WantedStatus | "");
            setOffset(0);
          }}
          options={[{ value: "", label: "All" }, ...wantedStatuses.map(value => ({ value, label: statusLabels[value] }))]}
        />
        <MarketFilter
          id="wanted-market"
          value={country}
          onChange={value => {
            setCountry(value);
            setOffset(0);
          }}
        />
        <Input aria-label="Words" placeholder="Search words" value={q} onChange={event => { setQ(event.target.value); setOffset(0); }} className="w-56" />
      </div>
      <Card className="mt-4">
        <DataTable columns={columns} rows={requests.data?.data} rowKey={row => row.id} loading={requests.isLoading} error={requests.error ? errorMessage(requests.error) : null} onRetry={requests.refetch} empty="No requests match." />
      </Card>
      {total > pageSize ? (
        <div className="mt-4 flex items-center justify-between gap-3 text-sm text-muted">
          <span>
            {offset + 1} to {Math.min(offset + pageSize, total)} of {formatNumber(total)}
          </span>
          <span className="flex gap-2">
            <Button size="sm" variant="ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - pageSize))}>
              Newer
            </Button>
            <Button size="sm" variant="ghost" disabled={offset + pageSize >= total} onClick={() => setOffset(offset + pageSize)}>
              Older
            </Button>
          </span>
        </div>
      ) : null}
      <ActionDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title="Remove this request?"
        description="Sellers can no longer see or answer it. Chats it started stay open."
        confirmLabel="Remove"
        tone="danger"
        onConfirm={async reason => void (await remove({ id: removing!.id, reason }).unwrap())}
      />
    </UdozoShell>
  );
}
