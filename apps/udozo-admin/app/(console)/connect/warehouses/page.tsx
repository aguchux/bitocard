"use client";

import { useId, useState } from "react";
import { ActionDialog, Badge, Button, Card, DataTable, errorMessage, Field, Input, PageHeader, Select, type Column } from "@bitocard/admin-ui";
import { can, useAdmin } from "@bitocard/admin-ui/shell";
import { type ConnectWarehouse, useConnectStatesQuery, useConnectWarehousesQuery, useCreateConnectWarehouseMutation, useUpdateConnectWarehouseMutation } from "@bitocard/api-client/admin";
import { MarketFilter } from "@/components/classifieds";
import { UdozoShell } from "@/components/shell";

type Draft = { country: string; state_id: string; name: string; address: string; hours: string; phone: string; contact_name: string };
const empty = (country: string): Draft => ({ country, state_id: "", name: "", address: "", hours: "", phone: "", contact_name: "" });

/** The fields of a warehouse, for adding one or changing it. */
function WarehouseFields({ draft, onChange, fixedCountry }: { draft: Draft; onChange: (next: Draft) => void; fixedCountry?: boolean }) {
  const id = useId();
  const states = useConnectStatesQuery(draft.country, { skip: !draft.country });
  const set = (key: keyof Draft) => (event: { target: { value: string } }) => onChange({ ...draft, [key]: event.target.value });
  return (
    <div className="grid gap-3">
      {fixedCountry ? null : <MarketFilter id={`${id}-country`} value={draft.country} onChange={country => onChange({ ...draft, country, state_id: "" })} all={false} />}
      <Field label="State" htmlFor={`${id}-state`}>
        <Select id={`${id}-state`} value={draft.state_id} onChange={set("state_id")}>
          <option value="">Choose a state</option>
          {(states.data?.data ?? []).map(state => (
            <option key={state.id} value={state.id}>
              {state.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Name" htmlFor={`${id}-name`}>
        <Input id={`${id}-name`} value={draft.name} onChange={set("name")} />
      </Field>
      <Field label="Address" htmlFor={`${id}-address`}>
        <Input id={`${id}-address`} value={draft.address} onChange={set("address")} />
      </Field>
      <Field label="Opening hours" htmlFor={`${id}-hours`}>
        <Input id={`${id}-hours`} value={draft.hours} onChange={set("hours")} />
      </Field>
      <Field label="Phone" htmlFor={`${id}-phone`}>
        <Input id={`${id}-phone`} value={draft.phone} onChange={set("phone")} />
      </Field>
      <Field label="Contact (optional)" htmlFor={`${id}-contact`}>
        <Input id={`${id}-contact`} value={draft.contact_name} onChange={set("contact_name")} />
      </Field>
    </div>
  );
}

/**
 * Connect > Warehouses: the warehouses Udozo runs, each a Final Return Address abandoned items are picked up to from
 * centres. Operations add them, change them and close them; support reads.
 */
export default function ConnectWarehousesPage() {
  const admin = useAdmin();
  const operations = can(admin, "operations");
  const [country, setCountry] = useState("");
  const list = useConnectWarehousesQuery({ country: country || undefined });
  const [create] = useCreateConnectWarehouseMutation();
  const [update] = useUpdateConnectWarehouseMutation();
  const [adding, setAdding] = useState<Draft | null>(null);
  const [editing, setEditing] = useState<{ row: ConnectWarehouse; draft: Draft } | null>(null);

  const columns: Array<Column<ConnectWarehouse>> = [
    {
      key: "name",
      header: "Warehouse",
      cell: row => (
        <span className="block min-w-0">
          <span className="block truncate font-semibold text-ink">{row.name}</span>
          <span className="block truncate text-xs text-muted">
            {row.address}, {row.state.name}
          </span>
        </span>
      ),
    },
    { key: "hours", header: "Hours", hideOnMobile: true, cell: row => <span className="text-sm">{row.hours}</span> },
    { key: "load", header: "Centres and items", cell: row => <span className="text-sm">{row.centres ?? 0} centres · {row.holding ?? 0} items</span> },
    { key: "active", header: "Status", cell: row => <Badge tone={row.active ? "green" : "grey"}>{row.active ? "Open" : "Closed"}</Badge> },
    {
      key: "act",
      header: "",
      align: "right",
      cell: row =>
        operations ? (
          <Button size="sm" variant="secondary" onClick={() => setEditing({ row, draft: { country: row.country, state_id: row.state.id, name: row.name, address: row.address, hours: row.hours, phone: row.phone, contact_name: row.contact_name ?? "" } })}>
            Change
          </Button>
        ) : null,
    },
  ];

  return (
    <UdozoShell section="connect" current="/connect/warehouses" crumbs={[{ label: "Connect", href: "/connect/applications" }, { label: "Warehouses" }]}>
      <PageHeader
        title="Warehouses"
        description="Udozo's own warehouses: each centre's Final Return Address, where Udozo takes the items sellers abandoned."
        actions={operations ? <Button onClick={() => setAdding(empty(country || "NG"))}>Add a warehouse</Button> : undefined}
      />
      <div className="mt-6">
        <MarketFilter id="warehouses-market" value={country} onChange={setCountry} />
      </div>
      <Card className="mt-4">
        <DataTable<ConnectWarehouse> caption="Warehouses" columns={columns} rows={list.data?.data} loading={list.isLoading} error={list.error ? errorMessage(list.error) : null} onRetry={list.refetch} rowKey={row => row.id} empty="No warehouses yet. Add the first, in Lagos." />
      </Card>
      {adding ? (
        <ActionDialog
          open
          onClose={() => setAdding(null)}
          title="Add a warehouse"
          confirmLabel="Add warehouse"
          requireReason={false}
          onConfirm={async () => void (await create({ ...adding, contact_name: adding.contact_name || null }).unwrap())}
        >
          <WarehouseFields draft={adding} onChange={setAdding} />
        </ActionDialog>
      ) : null}
      {editing ? (
        <ActionDialog
          open
          onClose={() => setEditing(null)}
          title={`Change ${editing.row.name}`}
          confirmLabel="Save"
          requireReason={false}
          onConfirm={async () => {
            const { draft } = editing;
            await update({ id: editing.row.id, state_id: draft.state_id, name: draft.name, address: draft.address, hours: draft.hours, phone: draft.phone, contact_name: draft.contact_name || null }).unwrap();
          }}
        >
          <WarehouseFields draft={editing.draft} onChange={draft => setEditing({ ...editing, draft })} fixedCountry />
          <div className="mt-3">
            <Button variant="secondary" onClick={() => void update({ id: editing.row.id, active: !editing.row.active }).unwrap().then(() => setEditing(null))}>
              {editing.row.active ? "Close this warehouse" : "Open it again"}
            </Button>
          </div>
        </ActionDialog>
      ) : null}
    </UdozoShell>
  );
}
