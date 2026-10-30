"use client";

import { useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { Button, Card, DataTable, Dialog, errorMessage, Field, formatDateTime, formatRelative, Input, Notice, PageHeader, Select, StatusBadge, Toggle } from "@bitocard/admin-ui";
import { AppLink } from "@bitocard/admin-ui/shell";
import { type UdozoWebhookEventType, useCreateWebhookEndpointMutation, useStoresQuery, useUpdateWebhookEndpointMutation, useWebhookEndpointsQuery } from "@bitocard/api-client/reseller";
import { ShqShell } from "@/components/shq-shell";
import { can, useReseller } from "@/components/reseller";
import { disabledReason, EventPicker, eventsSummary, ModeExplainer, SecretDialog } from "../developer-parts";

function CreateEndpointDialog({ open, onClose, onCreated, sandbox }: { open: boolean; onClose: () => void; onCreated: (secret: string) => void; sandbox: boolean }) {
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [events, setEvents] = useState<Array<UdozoWebhookEventType | "*">>(["*"]);
  const [storeId, setStoreId] = useState("");
  const stores = useStoresQuery().data?.data ?? [];
  const [create, state] = useCreateWebhookEndpointMutation();

  const close = () => {
    setUrl("");
    setDescription("");
    setEvents(["*"]);
    setStoreId("");
    state.reset();
    onClose();
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const created = await create({ url: url.trim(), description: description.trim() || undefined, events, ...(stores.length > 1 ? { store_id: storeId || stores[0].id } : {}) }).unwrap().catch(() => null);
    if (!created) return;
    close();
    onCreated(created.secret);
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title={sandbox ? "Add a sandbox endpoint" : "Add a live endpoint"}
      description={sandbox ? "It will receive sandbox events only." : "It will receive live events only."}
      footer={
        <>
          <Button variant="ghost" type="button" onClick={close} disabled={state.isLoading}>
            Cancel
          </Button>
          <Button type="submit" form="create-endpoint" loading={state.isLoading} disabled={!url.trim() || !events.length}>
            Add endpoint
          </Button>
        </>
      }
    >
      <form id="create-endpoint" onSubmit={submit} className="space-y-5">
        {state.error ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
        <Field label="Endpoint URL" htmlFor="endpoint-url" hint="An HTTPS address on the public internet.">
          <Input id="endpoint-url" type="url" inputMode="url" value={url} onChange={event => setUrl(event.target.value)} placeholder="https://example.com/webhooks/udozo" maxLength={2048} required autoFocus />
        </Field>
        {stores.length > 1 ? (
          <Field label="Store" htmlFor="endpoint-store" hint="It receives this store's events, and your account's own (wallet, payouts, checks).">
            <Select id="endpoint-store" value={storeId || stores[0].id} onChange={event => setStoreId(event.target.value)}>
              {stores.map(store => (
                <option key={store.id} value={store.id}>
                  {store.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <Field label="Description (optional)" htmlFor="endpoint-description">
          <Input id="endpoint-description" value={description} onChange={event => setDescription(event.target.value)} maxLength={200} placeholder="Order updates for our website" />
        </Field>
        <EventPicker idPrefix="create-events" value={events} onChange={setEvents} />
      </form>
    </Dialog>
  );
}

/** Webhook endpoints for the dashboard's current mode. The signing secret is shown once, kept only in this page's state. */
export default function WebhooksPage() {
  const { membership, mode } = useReseller();
  const manage = can(membership, "admin", "developer");
  const endpoints = useWebhookEndpointsQuery();
  const [update, updateState] = useUpdateWebhookEndpointMutation();
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);

  return (
    <ShqShell section="developers" current="/developers/webhooks" crumbs={[{ label: "Developers", href: "/developers" }, { label: "Webhooks" }]}>
      <PageHeader
        title="Webhooks"
        description="Udozo tells your systems when something happens, such as a resale order being placed or a payout being paid. Each request is signed so you can check it came from us."
        actions={
          <>
            {manage ? (
              <Button icon={<Plus className="size-4" aria-hidden />} onClick={() => setCreating(true)}>
                Add endpoint
              </Button>
            ) : null}
          </>
        }
      />
      <ModeExplainer mode={mode} subject="endpoints" />
      {updateState.error ? <Notice tone="red">{errorMessage(updateState.error)}</Notice> : null}

      <Card>
        <DataTable
          caption="Webhook endpoints"
          rows={endpoints.data?.data}
          loading={endpoints.isLoading}
          error={endpoints.error ? errorMessage(endpoints.error) : null}
          onRetry={endpoints.refetch}
          rowKey={endpoint => endpoint.id}
          empty={mode === "test" ? "No sandbox endpoints yet." : "No live endpoints yet."}
          columns={[
            {
              key: "url",
              header: "Endpoint",
              cell: endpoint => (
                <span className="block min-w-0 text-left">
                  <AppLink href={`/developers/webhooks/${endpoint.id}`} className="break-all font-semibold text-brand-600 hover:underline">
                    {endpoint.url}
                  </AppLink>
                  {endpoint.description ? <span className="block truncate text-xs font-normal text-muted">{endpoint.description}</span> : null}
                </span>
              ),
            },
            { key: "events", header: "Events", cell: endpoint => <span className="break-all text-sm">{eventsSummary(endpoint.events)}</span> },
            {
              key: "status",
              header: "Status",
              cell: endpoint => (
                <span className="inline-flex flex-col items-end gap-0.5 md:items-start">
                  <StatusBadge status={endpoint.status} label={endpoint.status === "disabled" && endpoint.disabled_reason === "failing" ? "Failing" : undefined} />
                  {disabledReason(endpoint) ? <span className="max-w-xs text-xs text-muted">{disabledReason(endpoint)}</span> : null}
                </span>
              ),
            },
            {
              key: "created",
              header: "Added",
              hideOnMobile: true,
              cell: endpoint => <span title={formatDateTime(endpoint.created_at)}>{formatRelative(endpoint.created_at)}</span>,
            },
            {
              key: "enabled",
              header: "On",
              align: "right",
              cell: endpoint =>
                manage ? (
                  <Toggle
                    label={`${endpoint.status === "enabled" ? "Turn off" : "Turn on"} ${endpoint.url}`}
                    checked={endpoint.status === "enabled"}
                    disabled={updateState.isLoading && updateState.originalArgs?.id === endpoint.id}
                    onChange={checked => void update({ id: endpoint.id, status: checked ? "enabled" : "disabled" })}
                  />
                ) : (
                  <span className="text-sm">{endpoint.status === "enabled" ? "Yes" : "No"}</span>
                ),
            },
          ]}
        />
      </Card>

      <CreateEndpointDialog open={creating} onClose={() => setCreating(false)} onCreated={setSecret} sandbox={mode === "test"} />
      <SecretDialog
        secret={secret}
        title="Your signing secret"
        description="Use it to check the Udozo-Signature header on every request. You can rotate it from the endpoint's page."
        onClose={() => setSecret(null)}
      />
    </ShqShell>
  );
}
