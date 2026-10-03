"use client";

import { useState, type FormEvent } from "react";
import { useParams, useRouter } from "next/navigation";
import { Pencil, Power, RefreshCw, RotateCw, Send, Trash2 } from "lucide-react";
import {
  ActionDialog,
  Badge,
  Button,
  Card,
  CardHeader,
  DataTable,
  Dialog,
  ErrorState,
  errorMessage,
  Field,
  formatDateTime,
  formatRelative,
  Input,
  KeyValue,
  LoadMore,
  Notice,
  PageHeader,
  Select,
  Skeleton,
  StatusBadge,
  Tabs,
} from "@bitocard/admin-ui";
import {
  type WebhookDelivery,
  type WebhookDeliveryStatus,
  type WebhookEndpoint,
  type WebhookEventType,
  useDeleteWebhookEndpointMutation,
  useResendWebhookDeliveryMutation,
  useRotateWebhookSecretMutation,
  useSendWebhookTestMutation,
  useUpdateWebhookEndpointMutation,
  useWebhookDeliveriesInfiniteQuery,
  useWebhookDeliveryQuery,
  useWebhookEndpointQuery,
} from "@bitocard/api-client/reseller";
import { ShqShell } from "@/components/shq-shell";
import { can, useReseller } from "@/components/reseller";
import { disabledReason, EventPicker, ModeBadge, SecretDialog } from "../../developer-parts";

const filters = [
  { value: "all", label: "All" },
  { value: "failed", label: "Failed" },
  { value: "pending", label: "Retrying" },
  { value: "succeeded", label: "Succeeded" },
] as const;
type Filter = (typeof filters)[number]["value"];

const responseLabel = (status: number | null, error: string | null) => (status ? `HTTP ${status}` : error ? "No response" : "—");

function EditDialog({ endpoint, open, onClose }: { endpoint: WebhookEndpoint; open: boolean; onClose: () => void }) {
  const [url, setUrl] = useState(endpoint.url);
  const [description, setDescription] = useState(endpoint.description ?? "");
  const [events, setEvents] = useState<Array<WebhookEventType | "*">>(endpoint.events);
  const [update, state] = useUpdateWebhookEndpointMutation();
  const close = () => {
    state.reset();
    onClose();
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const saved = await update({ id: endpoint.id, url: url.trim(), description: description.trim(), events }).unwrap().catch(() => null);
    if (saved) close();
  };
  return (
    <Dialog
      open={open}
      onClose={close}
      title="Edit endpoint"
      footer={
        <>
          <Button variant="ghost" type="button" onClick={close} disabled={state.isLoading}>
            Cancel
          </Button>
          <Button type="submit" form="edit-endpoint" loading={state.isLoading} disabled={!url.trim() || !events.length}>
            Save changes
          </Button>
        </>
      }
    >
      <form id="edit-endpoint" onSubmit={submit} className="space-y-5">
        {state.error ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
        <Field label="Endpoint URL" htmlFor="edit-url" hint="An HTTPS address on the public internet.">
          <Input id="edit-url" type="url" inputMode="url" value={url} onChange={event => setUrl(event.target.value)} maxLength={2048} required />
        </Field>
        <Field label="Description" htmlFor="edit-description">
          <Input id="edit-description" value={description} onChange={event => setDescription(event.target.value)} maxLength={200} />
        </Field>
        <EventPicker idPrefix="edit-events" value={events} onChange={setEvents} />
      </form>
    </Dialog>
  );
}

/** One delivery with its attempts: response status, time taken, any error and the start of the response body. */
function DeliveryDialog({ endpointId, deliveryId, manage, onClose }: { endpointId: string; deliveryId: string | null; manage: boolean; onClose: () => void }) {
  const delivery = useWebhookDeliveryQuery({ endpoint: endpointId, delivery: deliveryId ?? "" }, { skip: !deliveryId });
  const [resend, resendState] = useResendWebhookDeliveryMutation();
  const data = delivery.currentData;
  const close = () => {
    resendState.reset();
    onClose();
  };
  return (
    <Dialog
      open={Boolean(deliveryId)}
      onClose={close}
      title="Delivery"
      description={data ? <span className="break-all font-mono text-xs">{data.event.type}</span> : undefined}
      footer={
        manage && data ? (
          <Button
            icon={<RotateCw className="size-4" aria-hidden />}
            loading={resendState.isLoading}
            onClick={() => void resend({ endpoint: endpointId, delivery: data.id })}
          >
            Resend now
          </Button>
        ) : undefined
      }
    >
      {delivery.error ? (
        <ErrorState message={errorMessage(delivery.error)} onRetry={delivery.refetch} />
      ) : !data ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading">
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : (
        <div className="space-y-5">
          {resendState.error ? <Notice tone="red">{errorMessage(resendState.error)}</Notice> : null}
          {resendState.data ? (
            <Notice tone={resendState.data.log?.[0]?.success ? "green" : "red"}>
              {resendState.data.log?.[0]?.success ? "Sent again: your endpoint accepted it." : "Sent again, but your endpoint did not accept it. See the latest attempt below."}
            </Notice>
          ) : null}
          <KeyValue
            items={[
              { label: "Status", value: <StatusBadge status={data.status} label={data.status === "pending" ? "Retrying" : undefined} /> },
              { label: "Attempts", value: data.attempts },
              { label: "Event ID", value: <span className="break-all font-mono text-xs">{data.event.id}</span> },
              { label: "Event time", value: formatDateTime(data.event.created_at) },
              ...(data.next_attempt_at ? [{ label: "Next try", value: `${formatRelative(data.next_attempt_at)} (${formatDateTime(data.next_attempt_at)})` }] : []),
            ]}
          />
          <div>
            <h3 className="text-sm font-semibold text-ink">Attempts, newest first</h3>
            {data.log?.length ? (
              <ol className="mt-2 space-y-2">
                {data.log.map((attempt, index) => (
                  <li key={`${attempt.created_at}-${index}`} className="space-y-1.5 rounded-xl border border-line p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={attempt.success ? "green" : "red"}>{attempt.success ? "Accepted" : "Failed"}</Badge>
                      <span className="font-mono text-xs">{responseLabel(attempt.response_status, attempt.error)}</span>
                      {attempt.duration_ms !== null ? <span className="text-xs text-muted">{`${attempt.duration_ms} ms`}</span> : null}
                      {attempt.manual ? <Badge tone="blue" dot={false}>Manual</Badge> : null}
                      <span className="ml-auto text-xs text-muted" title={formatDateTime(attempt.created_at)}>
                        {formatRelative(attempt.created_at)}
                      </span>
                    </div>
                    {attempt.error ? <p className="break-words text-xs text-red-700">{attempt.error}</p> : null}
                    {attempt.response_body ? (
                      <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap break-all rounded-lg bg-canvas p-2 font-mono text-xs text-ink">{attempt.response_body}</pre>
                    ) : null}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-2 text-sm text-muted">Not attempted yet.</p>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}

function Deliveries({ endpointId, manage }: { endpointId: string; manage: boolean }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<string | null>(null);
  const status: WebhookDeliveryStatus | undefined = filter === "all" ? undefined : filter;
  const deliveries = useWebhookDeliveriesInfiniteQuery({ endpoint: endpointId, status });
  const rows = deliveries.data?.pages.flatMap(page => page.data);
  return (
    <Card>
      <CardHeader
        title="Deliveries"
        description="Every attempt to send an event to this endpoint, newest first. Kept for 30 days."
        actions={
          <Button variant="ghost" size="sm" icon={<RefreshCw className="size-4" aria-hidden />} loading={deliveries.isFetching && !deliveries.isLoading} onClick={() => void deliveries.refetch()}>
            Refresh
          </Button>
        }
      />
      <div className="mt-3 px-5 sm:px-6">
        <Tabs label="Show deliveries" value={filter} onChange={setFilter} items={filters.map(item => ({ value: item.value, label: item.label }))} />
      </div>
      <DataTable<WebhookDelivery>
        caption="Deliveries"
        rows={rows}
        loading={deliveries.isLoading}
        error={deliveries.error ? errorMessage(deliveries.error) : null}
        onRetry={deliveries.refetch}
        rowKey={row => row.id}
        onRowClick={row => setOpen(row.id)}
        empty={filter === "all" ? "Nothing sent yet. Send a test event to try your endpoint." : "No deliveries here."}
        columns={[
          { key: "event", header: "Event", cell: row => <span className="break-all font-mono text-xs">{row.event.type}</span> },
          { key: "status", header: "Status", cell: row => <StatusBadge status={row.status} label={row.status === "pending" ? "Retrying" : undefined} /> },
          { key: "response", header: "Response", cell: row => <span className="font-mono text-xs">{responseLabel(row.last_response_status, row.last_error)}</span> },
          { key: "attempts", header: "Attempts", hideOnMobile: true, cell: row => row.attempts },
          {
            key: "when",
            header: "Created",
            cell: row => <span title={formatDateTime(row.created_at)}>{formatRelative(row.created_at)}</span>,
          },
          {
            key: "next",
            header: "Next try",
            hideOnMobile: true,
            cell: row => (row.next_attempt_at && row.status === "pending" ? <span title={formatDateTime(row.next_attempt_at)}>{formatRelative(row.next_attempt_at)}</span> : "—"),
          },
        ]}
      />
      <LoadMore hasMore={deliveries.hasNextPage} loading={deliveries.isFetchingNextPage} onClick={() => void deliveries.fetchNextPage()} />
      <DeliveryDialog endpointId={endpointId} deliveryId={open} manage={manage} onClose={() => setOpen(null)} />
    </Card>
  );
}

/** One webhook endpoint: its settings, secret rotation, a test event and the delivery log. */
export default function WebhookEndpointPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { membership } = useReseller();
  const manage = can(membership, "admin", "developer");
  const endpoint = useWebhookEndpointQuery(id);
  const [update, updateState] = useUpdateWebhookEndpointMutation();
  const [rotate] = useRotateWebhookSecretMutation();
  const [remove] = useDeleteWebhookEndpointMutation();
  const [sendTest, testState] = useSendWebhookTestMutation();
  const [editing, setEditing] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [overlap, setOverlap] = useState("24");
  const [deleting, setDeleting] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const data = endpoint.data;
  const crumbs = [{ label: "Developers", href: "/developers" }, { label: "Webhooks", href: "/developers/webhooks" }, { label: "Endpoint" }];

  if (!data) {
    return (
      <ShqShell section="developers" current="/developers/webhooks" crumbs={crumbs}>
        {endpoint.error ? (
          <Card>
            <ErrorState message={errorMessage(endpoint.error)} onRetry={endpoint.refetch} />
          </Card>
        ) : (
          <div className="space-y-4" aria-busy="true" aria-label="Loading">
            <Skeleton className="h-9 w-2/3" />
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        )}
      </ShqShell>
    );
  }

  const reason = disabledReason(data);
  const test = testState.data;

  return (
    <ShqShell section="developers" current="/developers/webhooks" crumbs={crumbs}>
      <PageHeader
        title={<span className="block break-all text-xl sm:text-2xl">{data.url}</span>}
        description={data.description ?? undefined}
        actions={
          manage ? (
            <>
              <Button variant="secondary" icon={<Send className="size-4" aria-hidden />} loading={testState.isLoading} onClick={() => void sendTest(data.id)}>
                Send test event
              </Button>
              <Button variant="ghost" icon={<Pencil className="size-4" aria-hidden />} onClick={() => setEditing(true)}>
                Edit
              </Button>
            </>
          ) : null
        }
      />

      {reason ? (
        <Notice tone={data.disabled_reason === "failing" ? "red" : "grey"} title="This endpoint is off">
          {reason} Events are not sent while it is off.
        </Notice>
      ) : null}
      {updateState.error ? <Notice tone="red">{errorMessage(updateState.error)}</Notice> : null}
      {testState.error ? <Notice tone="red">{errorMessage(testState.error)}</Notice> : null}
      {test ? (
        <Notice tone={test.status === "succeeded" ? "green" : "red"} title={test.status === "succeeded" ? "Test event accepted" : "Test event failed"}>
          {test.status === "succeeded"
            ? `Your endpoint answered ${responseLabel(test.last_response_status, null)}.`
            : `${responseLabel(test.last_response_status, test.last_error)}${test.last_error ? `: ${test.last_error}` : ""}. Test events are not retried.`}
        </Notice>
      ) : null}

      <Card className="p-5 sm:p-6">
        <KeyValue
          items={[
            { label: "Status", value: <StatusBadge status={data.status} /> },
            { label: "Mode", value: <ModeBadge mode={data.mode} /> },
            {
              label: "Events",
              value: data.events.includes("*") ? (
                "All events, including types added later"
              ) : (
                <span className="flex flex-wrap gap-1">
                  {data.events.map(type => (
                    <code key={type} className="break-all rounded bg-canvas px-1.5 py-0.5 font-mono text-xs">
                      {type}
                    </code>
                  ))}
                </span>
              ),
            },
            { label: "Added", value: formatDateTime(data.created_at) },
            {
              label: "Signing secret",
              value: data.previous_secret_expires_at ? `Rotated: the old secret also signs until ${formatDateTime(data.previous_secret_expires_at)}` : "Shown once when created or rotated",
            },
            { label: "Endpoint ID", value: <span className="break-all font-mono text-xs">{data.id}</span> },
          ]}
        />
        {manage ? (
          <div className="mt-5 flex flex-wrap gap-2 border-t border-line pt-5">
            <Button
              variant="secondary"
              size="sm"
              icon={<Power className="size-4" aria-hidden />}
              loading={updateState.isLoading}
              onClick={() => void update({ id: data.id, status: data.status === "enabled" ? "disabled" : "enabled" })}
            >
              {data.status === "enabled" ? "Turn off" : "Turn on"}
            </Button>
            <Button variant="secondary" size="sm" icon={<RefreshCw className="size-4" aria-hidden />} onClick={() => setRotating(true)}>
              Rotate secret
            </Button>
            <Button variant="ghost" size="sm" icon={<Trash2 className="size-4" aria-hidden />} onClick={() => setDeleting(true)}>
              Delete endpoint
            </Button>
          </div>
        ) : null}
      </Card>

      <Deliveries endpointId={data.id} manage={manage} />

      {editing ? <EditDialog endpoint={data} open={editing} onClose={() => setEditing(false)} /> : null}

      <ActionDialog
        open={rotating}
        onClose={() => {
          setRotating(false);
          setOverlap("24");
        }}
        title="Rotate the signing secret?"
        description="You get a new secret. While the old one is still valid, every request carries two signatures, one for each secret."
        confirmLabel="Rotate secret"
        requireReason={false}
        onConfirm={async () => {
          const rotated = await rotate({ id: data.id, expire_previous_in_hours: Number(overlap) }).unwrap();
          setSecret(rotated.secret);
        }}
      >
        <Field label="Keep signing with the old secret for" htmlFor="rotate-overlap" hint="Time to put the new secret in place on your server.">
          <Select id="rotate-overlap" value={overlap} onChange={event => setOverlap(event.target.value)}>
            <option value="0">No time: stop it now</option>
            <option value="1">1 hour</option>
            <option value="24">24 hours</option>
            <option value="72">3 days</option>
            <option value="168">7 days</option>
          </Select>
        </Field>
      </ActionDialog>

      <ActionDialog
        open={deleting}
        onClose={() => setDeleting(false)}
        title="Delete this endpoint?"
        description="Nothing more is sent to it and its delivery log is deleted. Events stay available from the events list for 30 days."
        confirmLabel="Delete endpoint"
        tone="danger"
        requireReason={false}
        onConfirm={async () => {
          await remove(data.id).unwrap();
          router.push("/developers/webhooks");
        }}
      />

      <SecretDialog
        secret={secret}
        title="Your new signing secret"
        description="Use it to check the BitoCard-Signature header. The old secret stops at the time you chose."
        onClose={() => setSecret(null)}
      />
    </ShqShell>
  );
}
