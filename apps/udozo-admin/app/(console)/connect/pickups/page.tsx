"use client";

import { useId, useState } from "react";
import { ActionDialog, Badge, Button, Card, CardHeader, DataTable, Dialog, errorMessage, Field, FilterSelect, formatDate, Input, PageHeader, type Column } from "@bitocard/admin-ui";
import { AppLink, can, useAdmin } from "@bitocard/admin-ui/shell";
import {
  type ConnectAwaitingPickup,
  type ConnectPickup,
  type ConnectWarehouseItem,
  useCancelConnectPickupMutation,
  useConnectAwaitingPickupsQuery,
  useConnectPickupsQuery,
  useConnectWarehouseItemsQuery,
  useHandBackAtWarehouseMutation,
  useReceiveConnectPickupMutation,
  useScheduleConnectPickupMutation,
} from "@bitocard/api-client/admin";
import { MarketFilter, PrivatePhoto } from "@/components/classifieds";
import { money } from "@/components/connect";
import { UdozoShell } from "@/components/shell";

const statusLabels: Record<ConnectPickup["status"], string> = { scheduled: "Scheduled", collected: "On its way", delivered: "At the warehouse", cancelled: "Cancelled" };
const statusTones: Record<ConnectPickup["status"], "blue" | "amber" | "green" | "grey"> = { scheduled: "blue", collected: "amber", delivered: "green", cancelled: "grey" };
const today = () => new Date().toISOString().slice(0, 10);

/**
 * Connect > Pickups: abandoned items waiting at centres, Udozo's pickups of them (the code Udozo's collector gives the
 * centre, then checking them in at the warehouse), and the items Udozo's warehouses hold, handed back to their sellers
 * against the seller's return code. Operations act; support reads.
 */
export default function ConnectPickupsPage() {
  const id = useId();
  const admin = useAdmin();
  const operations = can(admin, "operations");
  const [country, setCountry] = useState("");
  const [status, setStatus] = useState<ConnectPickup["status"] | "">("");
  const awaiting = useConnectAwaitingPickupsQuery({ country: country || undefined });
  const pickups = useConnectPickupsQuery({ country: country || undefined, status: status || undefined });
  const items = useConnectWarehouseItemsQuery();
  const [schedule] = useScheduleConnectPickupMutation();
  const [cancel] = useCancelConnectPickupMutation();
  const [receive] = useReceiveConnectPickupMutation();
  const [handBack] = useHandBackAtWarehouseMutation();
  const [scheduling, setScheduling] = useState<{ row: ConnectAwaitingPickup; day: string; collector: string } | null>(null);
  const [receiving, setReceiving] = useState<{ pickup: ConnectPickup; arrived: Set<string>; restMissing: boolean } | null>(null);
  const [cancelling, setCancelling] = useState<ConnectPickup | null>(null);
  const [returning, setReturning] = useState<{ item: ConnectWarehouseItem; code: string } | null>(null);
  const [viewing, setViewing] = useState<ConnectPickup | null>(null);

  const awaitingColumns: Array<Column<ConnectAwaitingPickup>> = [
    {
      key: "centre",
      header: "Centre",
      cell: row => (
        <AppLink href={`/connect/centres/${row.centre.id}`} className="block min-w-0 hover:underline">
          <span className="block truncate font-semibold text-ink">{row.centre.name}</span>
          <span className="block text-xs text-muted">{row.centre.number}</span>
        </AppLink>
      ),
    },
    { key: "items", header: "Abandoned items", cell: row => <span className="text-sm">{row.awaiting} waiting · {row.scheduled} on a pickup</span> },
    { key: "fra", header: "Final Return Address", hideOnMobile: true, cell: row => <span className="text-sm">{row.final_return_address?.name ?? "Not set"}</span> },
    {
      key: "act",
      header: "",
      align: "right",
      cell: row =>
        operations && row.awaiting > row.scheduled ? (
          <Button size="sm" onClick={() => setScheduling({ row, day: today(), collector: "" })}>
            Schedule a pickup
          </Button>
        ) : null,
    },
  ];

  const pickupColumns: Array<Column<ConnectPickup>> = [
    {
      key: "pickup",
      header: "Pickup",
      cell: row => (
        <span className="block min-w-0">
          <span className="block font-semibold text-ink">
            {row.number} · {formatDate(row.day)}
          </span>
          <span className="block truncate text-xs text-muted">
            {row.centre.name} to {row.warehouse.name} · {row.collector}
          </span>
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: row => (
        <span className="grid gap-1">
          <Badge tone={statusTones[row.status]}>{statusLabels[row.status]}</Badge>
          <span className="text-xs text-muted">{row.items.filter(item => item.status !== "removed").length} items</span>
          {row.photos?.length ? (
            <button type="button" onClick={() => setViewing(row)} className="text-left text-xs font-semibold text-brand-600 hover:underline">
              {row.photos.length === 1 ? "1 check-out photo" : `${row.photos.length} check-out photos`}
            </button>
          ) : null}
        </span>
      ),
    },
    {
      key: "code",
      header: "Pickup code",
      hideOnMobile: true,
      cell: row => (row.code ? <span className="font-mono text-base font-bold tracking-widest text-ink">{row.code}</span> : <span className="text-sm text-muted">—</span>),
    },
    {
      key: "act",
      header: "",
      align: "right",
      cell: row =>
        !operations ? null : row.status === "collected" ? (
          <Button size="sm" onClick={() => setReceiving({ pickup: row, arrived: new Set(row.items.filter(item => item.status === "handed_over").map(item => item.order_id)), restMissing: false })}>
            Check in at the warehouse
          </Button>
        ) : row.status === "scheduled" ? (
          <Button size="sm" variant="secondary" onClick={() => setCancelling(row)}>
            Cancel
          </Button>
        ) : null,
    },
  ];

  const itemColumns: Array<Column<ConnectWarehouseItem>> = [
    {
      key: "item",
      header: "Item",
      cell: row => (
        <AppLink href={`/classifieds/orders/${row.order_id}`} className="block min-w-0 hover:underline">
          <span className="block truncate font-semibold text-ink">{row.title}</span>
          <span className="block text-xs text-muted">
            {row.number} · {money(row.price, row.currency)}
          </span>
        </AppLink>
      ),
    },
    { key: "where", header: "Where", cell: row => <span className="text-sm">{row.warehouse?.name ?? "—"} · from {row.centre?.name ?? "a centre"}</span> },
    { key: "since", header: "In Loss of care since", hideOnMobile: true, cell: row => <span className="text-sm">{row.loss_of_care_at ? formatDate(row.loss_of_care_at) : "—"}</span> },
    {
      key: "act",
      header: "",
      align: "right",
      cell: row =>
        operations && row.return_id ? (
          <Button size="sm" variant="secondary" onClick={() => setReturning({ item: row, code: "" })}>
            Hand back to the seller
          </Button>
        ) : null,
    },
  ];

  return (
    <UdozoShell section="connect" current="/connect/pickups" crumbs={[{ label: "Connect", href: "/connect/applications" }, { label: "Pickups" }]}>
      <PageHeader title="Pickups" description="Abandoned items Udozo picks up from centres to their Final Return Address, and what Udozo's warehouses hold." />
      <div className="mt-6">
        <MarketFilter id="pickups-market" value={country} onChange={setCountry} />
      </div>
      <Card className="mt-4">
        <CardHeader title="Waiting at centres" description="Items abandoned a month into Loss of care, to pick up." />
        <DataTable<ConnectAwaitingPickup> caption="Abandoned items waiting at centres" columns={awaitingColumns} rows={awaiting.data?.data} loading={awaiting.isLoading} error={awaiting.error ? errorMessage(awaiting.error) : null} onRetry={awaiting.refetch} rowKey={row => row.centre.id} empty="Nothing waiting at any centre." />
      </Card>
      <Card className="mt-4">
        <CardHeader
          title="Pickups"
          description="Give the collector the pickup code: the centre hands the items over against it."
          actions={
            <FilterSelect
              id="pickups-status"
              label="Status"
              value={status}
              onChange={value => setStatus(value as ConnectPickup["status"] | "")}
              options={[{ value: "", label: "All" }, ...(Object.keys(statusLabels) as Array<ConnectPickup["status"]>).map(value => ({ value, label: statusLabels[value] }))]}
            />
          }
        />
        <DataTable<ConnectPickup> caption="Pickups" columns={pickupColumns} rows={pickups.data?.data} loading={pickups.isLoading} error={pickups.error ? errorMessage(pickups.error) : null} onRetry={pickups.refetch} rowKey={row => row.id} empty="No pickups yet." />
      </Card>
      <Card className="mt-4">
        <CardHeader title="At Udozo's warehouses" description="Abandoned items Udozo holds. A seller can still collect one after paying what is owed, until it is auctioned." />
        <DataTable<ConnectWarehouseItem> caption="Items at Udozo's warehouses" columns={itemColumns} rows={items.data?.data} loading={items.isLoading} error={items.error ? errorMessage(items.error) : null} onRetry={items.refetch} rowKey={row => row.order_id} empty="The warehouses hold nothing." />
      </Card>

      {scheduling ? (
        <ActionDialog
          open
          onClose={() => setScheduling(null)}
          title={`Pick up from ${scheduling.row.centre.name}`}
          description={`Every abandoned item waiting there goes to ${scheduling.row.final_return_address?.name ?? "its Final Return Address (set it on the centre's page first)"}.`}
          confirmLabel="Schedule pickup"
          requireReason={false}
          onConfirm={async () => void (await schedule({ centre_id: scheduling.row.centre.id, day: scheduling.day, collector: scheduling.collector }).unwrap())}
        >
          <div className="grid gap-3">
            <Field label="Day" htmlFor={`${id}-day`}>
              <Input id={`${id}-day`} type="date" value={scheduling.day} onChange={event => setScheduling({ ...scheduling, day: event.target.value })} />
            </Field>
            <Field label="Who collects" htmlFor={`${id}-collector`} hint="The centre sees this name.">
              <Input id={`${id}-collector`} value={scheduling.collector} onChange={event => setScheduling({ ...scheduling, collector: event.target.value })} />
            </Field>
          </div>
        </ActionDialog>
      ) : null}
      {receiving ? (
        <ActionDialog
          open
          onClose={() => setReceiving(null)}
          title={`Check in ${receiving.pickup.number}`}
          description="Tick what arrived at the warehouse."
          confirmLabel="Check in"
          requireReason={false}
          onConfirm={async () => {
            const handed = receiving.pickup.items.filter(item => item.status === "handed_over").map(item => item.order_id);
            const arrived = handed.filter(orderId => receiving.arrived.has(orderId));
            const missing = receiving.restMissing ? handed.filter(orderId => !receiving.arrived.has(orderId)) : [];
            await receive({ id: receiving.pickup.id, order_ids: arrived, missing }).unwrap();
          }}
        >
          <ul className="grid gap-1">
            {receiving.pickup.items
              .filter(item => item.status === "handed_over")
              .map(item => (
                <li key={item.order_id}>
                  <label className="flex min-h-10 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={receiving.arrived.has(item.order_id)}
                      onChange={() => {
                        const arrived = new Set(receiving.arrived);
                        if (arrived.has(item.order_id)) arrived.delete(item.order_id);
                        else arrived.add(item.order_id);
                        setReceiving({ ...receiving, arrived });
                      }}
                    />
                    {item.title} <span className="text-muted">{item.number}</span>
                  </label>
                </li>
              ))}
          </ul>
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={receiving.restMissing} onChange={() => setReceiving({ ...receiving, restMissing: !receiving.restMissing })} />
            What is not ticked never arrived: flag it missing
          </label>
        </ActionDialog>
      ) : null}
      {viewing ? (
        <Dialog open onClose={() => setViewing(null)} title={`${viewing.number}: check-out photos`}>
          <p className="mb-3 text-sm text-muted">What {viewing.centre.name} photographed as it handed the items to {viewing.collector}. Each view is recorded.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {viewing.photos.map((photo, index) => (
              <PrivatePhoto key={photo.id} path={`/v1/admin/connect/pickups/${viewing.id}/photos/${photo.id}`} alt={`Check-out photo ${index + 1}`} />
            ))}
          </div>
        </Dialog>
      ) : null}
      {cancelling ? (
        <ActionDialog open onClose={() => setCancelling(null)} title={`Cancel ${cancelling.number}?`} description="Its items wait for another pickup." confirmLabel="Cancel pickup" tone="danger" onConfirm={async reason => void (await cancel({ id: cancelling.id, reason }).unwrap())} />
      ) : null}
      {returning ? (
        <ActionDialog
          open
          onClose={() => setReturning(null)}
          title={`Hand "${returning.item.title}" back`}
          description="The seller gives their return code. Storage owed and the return fee are taken from their Udozo money first; without enough, they add it to their wallet."
          confirmLabel="Hand back"
          requireReason={false}
          onConfirm={async () => void (await handBack({ id: returning.item.return_id!, code: returning.code }).unwrap())}
        >
          <Field label="Seller's return code" htmlFor={`${id}-code`}>
            <Input id={`${id}-code`} inputMode="numeric" value={returning.code} onChange={event => setReturning({ ...returning, code: event.target.value })} />
          </Field>
        </ActionDialog>
      ) : null}
    </UdozoShell>
  );
}
