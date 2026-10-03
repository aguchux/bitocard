"use client";

import { useState } from "react";
import { Card, DataTable, Dialog, errorMessage, FilterSelect, formatDateTime, formatRelative, KeyValue, LoadMore, PageHeader } from "@bitocard/admin-ui";
import { type WebhookEvent, type WebhookEventType, useEventsInfiniteQuery, webhookEventTypes } from "@bitocard/api-client/reseller";
import { ShqShell } from "@/components/shq-shell";
import { useReseller } from "@/components/reseller";
import { CopyButton, ModeBadge, ModeExplainer } from "../developer-parts";

const periods = [
  { value: "30d", label: "Last 30 days", hours: null },
  { value: "7d", label: "Last 7 days", hours: 24 * 7 },
  { value: "24h", label: "Last 24 hours", hours: 24 },
  { value: "1h", label: "Last hour", hours: 1 },
] as const;
type Period = (typeof periods)[number]["value"];

const objectId = (event: WebhookEvent) => (typeof event.data.object.id === "string" ? event.data.object.id : null);

function EventDialog({ event, onClose }: { event: WebhookEvent | null; onClose: () => void }) {
  const json = event ? JSON.stringify(event, null, 2) : "";
  return (
    <Dialog open={Boolean(event)} onClose={onClose} title="Event" description={event ? <span className="break-all font-mono text-xs">{event.type}</span> : undefined} footer={event ? <CopyButton value={json} label="Copy JSON" /> : undefined}>
      {event ? (
        <div className="space-y-4">
          <KeyValue
            items={[
              { label: "Event ID", value: <span className="break-all font-mono text-xs">{event.id}</span> },
              { label: "Created", value: formatDateTime(event.created_at) },
              { label: "Mode", value: <ModeBadge mode={event.mode} /> },
              { label: "Payload version", value: <span className="font-mono text-xs">{event.api_version}</span> },
            ]}
          />
          <div>
            <h3 className="text-sm font-semibold text-ink">Payload, as sent to your endpoints</h3>
            <pre className="mt-2 max-h-[50vh] overflow-y-auto whitespace-pre-wrap break-all rounded-lg bg-slate-900 p-3 font-mono text-xs leading-relaxed text-slate-100">{json}</pre>
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}

/** Every event from the last 30 days in the dashboard's mode: the source of truth webhooks are sent from. */
export default function EventsPage() {
  const { mode } = useReseller();
  const [type, setType] = useState<WebhookEventType | "">("");
  const [period, setPeriod] = useState<Period>("30d");
  const [since, setSince] = useState<string | undefined>(undefined);
  const [open, setOpen] = useState<WebhookEvent | null>(null);
  const events = useEventsInfiniteQuery({ type: type || undefined, since });
  const rows = events.data?.pages.flatMap(page => page.data);

  const choosePeriod = (value: string) => {
    const chosen = periods.find(item => item.value === value) ?? periods[0];
    setPeriod(chosen.value);
    setSince(chosen.hours ? new Date(Date.now() - chosen.hours * 3600 * 1000).toISOString() : undefined);
  };

  return (
    <ShqShell section="developers" current="/developers/events" crumbs={[{ label: "Developers", href: "/developers" }, { label: "Events" }]}>
      <PageHeader
        title="Events"
        description="What happened in your account, oldest first, kept for 30 days. Your systems can fetch the same list from GET /v1/events to catch up on anything a webhook missed."
      />
      <ModeExplainer mode={mode} subject="events" />
      <div className="flex flex-wrap gap-3">
        <FilterSelect
          id="event-type"
          label="Type"
          value={type}
          onChange={value => setType(value as WebhookEventType | "")}
          options={[{ value: "", label: "All types" }, ...webhookEventTypes.map(item => ({ value: item, label: item }))]}
        />
        <FilterSelect id="event-period" label="From" value={period} onChange={choosePeriod} options={periods.map(item => ({ value: item.value, label: item.label }))} />
      </div>
      <Card>
        <DataTable<WebhookEvent>
          caption="Events"
          rows={rows}
          loading={events.isLoading}
          error={events.error ? errorMessage(events.error) : null}
          onRetry={events.refetch}
          rowKey={row => row.id}
          onRowClick={setOpen}
          empty={mode === "test" ? "No sandbox events in this period." : "No live events in this period."}
          columns={[
            { key: "type", header: "Type", cell: row => <span className="break-all font-mono text-xs font-semibold">{row.type}</span> },
            {
              key: "object",
              header: "Object",
              cell: row => {
                const id = objectId(row);
                return id ? <span className="block max-w-[11rem] truncate font-mono text-xs text-muted sm:max-w-xs" title={id}>{id}</span> : <span className="text-muted">—</span>;
              },
            },
            { key: "created", header: "Created", cell: row => <span title={formatDateTime(row.created_at)}>{formatRelative(row.created_at)}</span> },
            { key: "id", header: "Event ID", hideOnMobile: true, cell: row => <span className="block max-w-xs truncate font-mono text-xs text-subtle" title={row.id}>{row.id}</span> },
          ]}
        />
        <LoadMore hasMore={events.hasNextPage} loading={events.isFetchingNextPage} onClick={() => void events.fetchNextPage()} />
      </Card>
      <EventDialog event={open} onClose={() => setOpen(null)} />
    </ShqShell>
  );
}
