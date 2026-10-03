"use client";

import { useState } from "react";
import { Card, DataTable, Dialog, errorMessage, FilterSelect, formatDateTime, humanise, LoadMore, PageHeader } from "@bitocard/admin-ui";
import { AdminShell } from "@bitocard/admin-ui/shell";
import { type AuditEntry, useActivityInfiniteQuery } from "@bitocard/api-client/admin";

const targets = ["reseller", "order", "supplier", "product", "pricing_rule", "country", "switch", "plan", "currency", "tax_rate", "store"];

const json = (value: unknown) => (value === null || value === undefined ? "—" : JSON.stringify(value, null, 2));

export default function ActivityPage() {
  const [target, setTarget] = useState("");
  const [open, setOpen] = useState<AuditEntry | null>(null);
  const query = useActivityInfiniteQuery({ target_type: target || undefined });
  const rows = query.data?.pages.flatMap(page => page.data);

  return (
    <AdminShell section="activity" current="/activity" crumbs={[{ label: "Activity", href: "/activity" }, { label: "Activity log" }]}>
      <PageHeader title="Activity log" description="Every admin change, who made it, and the record before and after." />
      <div className="flex flex-wrap gap-3">
        <FilterSelect
          id="target"
          label="Changes to"
          value={target}
          onChange={setTarget}
          options={[{ value: "", label: "Everything" }, ...targets.map(value => ({ value, label: humanise(value) }))]}
        />
      </div>
      <Card>
        <DataTable
          caption="Activity"
          rows={rows}
          loading={query.isLoading}
          error={query.error ? errorMessage(query.error) : null}
          onRetry={query.refetch}
          rowKey={entry => entry.id}
          onRowClick={setOpen}
          empty="No admin changes yet."
          columns={[
            { key: "action", header: "Change", cell: entry => <span className="font-medium">{humanise(entry.action)}</span> },
            { key: "who", header: "By", cell: entry => entry.actor?.name ?? entry.actor?.email ?? "System" },
            {
              key: "target",
              header: "Record",
              cell: entry => <span className="font-mono text-xs text-muted">{`${entry.target_type} ${entry.target_id.slice(0, 8)}`}</span>,
              hideOnMobile: true,
            },
            { key: "when", header: "When", cell: entry => <span className="text-muted">{formatDateTime(entry.created_at)}</span> },
          ]}
        />
        <LoadMore hasMore={query.hasNextPage} loading={query.isFetchingNextPage} onClick={() => query.fetchNextPage()} />
      </Card>
      <Dialog
        open={open !== null}
        onClose={() => setOpen(null)}
        title={open ? humanise(open.action) : ""}
        description={open ? `${open.actor?.email ?? "System"} · ${formatDateTime(open.created_at)}` : undefined}
      >
        {open ? (
          <div className="grid gap-4">
            {(["before", "after"] as const).map(side => (
              <div key={side}>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-subtle">{side}</p>
                <pre className="max-h-64 overflow-auto rounded-xl bg-canvas p-3 text-xs">{json(open[side])}</pre>
              </div>
            ))}
          </div>
        ) : null}
      </Dialog>
    </AdminShell>
  );
}
