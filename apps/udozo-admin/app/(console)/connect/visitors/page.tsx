"use client";

import { useId, useState, type FormEvent } from "react";
import { Badge, Button, Card, CardHeader, DataTable, errorMessage, Field, Input, Notice, PageHeader, Select, type Column } from "@bitocard/admin-ui";
import { can, useAdmin } from "@bitocard/admin-ui/shell";
import { type ConnectVisitor, useConnectVisitorsQuery, useCreateConnectVisitorMutation, useUpdateConnectVisitorMutation } from "@bitocard/api-client/admin";
import { MarketFilter, useMarketOptions } from "@/components/classifieds";
import { UdozoShell } from "@/components/shell";

function AddVisitor() {
  const id = useId();
  const markets = useMarketOptions();
  const [create, state] = useCreateConnectVisitorMutation();
  const [country, setCountry] = useState("NG");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [kind, setKind] = useState<"staff" | "agent">("staff");
  const [trained, setTrained] = useState(false);
  const [added, setAdded] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setAdded(null);
    const made = await create({ country, name: name.trim(), phone: phone.trim() || null, email: email.trim() || null, kind, ...(kind === "agent" ? { trained } : {}) })
      .unwrap()
      .catch(() => null);
    if (!made) return;
    setAdded(made.name);
    setName("");
    setPhone("");
    setEmail("");
    setKind("staff");
    setTrained(false);
  };

  return (
    <Card>
      <CardHeader title="Add a visitor" description="Staff can visit at once. An agent can visit once they have finished Udozo's training." />
      <form onSubmit={submit} className="space-y-4 px-5 pb-5 sm:px-6">
        {state.error ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
        {added ? <Notice tone="green">{added} was added.</Notice> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Market" htmlFor={`${id}-market`}>
            <Select id={`${id}-market`} value={country} onChange={event => setCountry(event.target.value)}>
              {(markets.length ? markets : [{ value: "NG", label: "Nigeria" }]).map(item => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Name" htmlFor={`${id}-name`}>
            <Input id={`${id}-name`} value={name} onChange={event => setName(event.target.value)} maxLength={80} required />
          </Field>
          <Field label="Phone" htmlFor={`${id}-phone`}>
            <Input id={`${id}-phone`} type="tel" value={phone} onChange={event => setPhone(event.target.value)} maxLength={30} />
          </Field>
          <Field label="Email" htmlFor={`${id}-email`}>
            <Input id={`${id}-email`} type="email" value={email} onChange={event => setEmail(event.target.value)} maxLength={200} />
          </Field>
          <Field label="Kind" htmlFor={`${id}-kind`}>
            <Select id={`${id}-kind`} value={kind} onChange={event => setKind(event.target.value as "staff" | "agent")}>
              <option value="staff">Udozo staff</option>
              <option value="agent">Agent</option>
            </Select>
          </Field>
          {kind === "agent" ? (
            <label className="flex items-center gap-2 self-end pb-2 text-sm text-ink">
              <input type="checkbox" checked={trained} onChange={event => setTrained(event.target.checked)} />
              Finished Udozo&apos;s training
            </label>
          ) : null}
        </div>
        <Button type="submit" loading={state.isLoading} disabled={name.trim().length < 2}>
          Add visitor
        </Button>
      </form>
    </Card>
  );
}

/**
 * Connect > Visitors: who visits applicants' offices before they are approved, Udozo's staff or trained agents, per
 * market. Operations add them, mark agents trained and deactivate them; only those who can visit are offered.
 */
export default function ConnectVisitorsPage() {
  const admin = useAdmin();
  const acts = can(admin, "operations");
  const [country, setCountry] = useState("");
  const visitors = useConnectVisitorsQuery(country || undefined);
  const [update, updateState] = useUpdateConnectVisitorMutation();

  const columns: Array<Column<ConnectVisitor>> = [
    {
      key: "visitor",
      header: "Visitor",
      cell: row => (
        <span className="block min-w-0">
          <span className="block truncate font-semibold text-ink">{row.name}</span>
          <span className="block truncate text-xs text-muted">{[row.phone, row.email].filter(Boolean).join(" · ") || "No contact details"}</span>
        </span>
      ),
    },
    {
      key: "kind",
      header: "Kind",
      cell: row => (
        <span className="grid gap-1 text-sm">
          <span>{row.kind === "agent" ? "Agent" : "Staff"}</span>
          {row.kind === "agent" ? <span className="text-xs text-muted">{row.trained_at ? "Trained" : "Not trained yet"}</span> : null}
        </span>
      ),
    },
    { key: "market", header: "Market", hideOnMobile: true, cell: row => row.country },
    {
      key: "status",
      header: "Status",
      cell: row => (
        <span className="grid gap-1">
          {row.active ? <Badge tone="green">Active</Badge> : <Badge tone="grey">Inactive</Badge>}
          <span className="text-xs text-muted">{row.can_visit ? "Can visit" : "Cannot visit"}</span>
        </span>
      ),
    },
    ...(acts
      ? [
          {
            key: "actions",
            header: "",
            cell: (row: ConnectVisitor) => (
              <span className="flex flex-wrap justify-end gap-2">
                {row.kind === "agent" && !row.trained_at ? (
                  <Button size="sm" variant="secondary" onClick={() => void update({ id: row.id, trained: true })}>
                    Mark trained
                  </Button>
                ) : null}
                <Button size="sm" variant="ghost" onClick={() => void update({ id: row.id, active: !row.active })}>
                  {row.active ? "Deactivate" : "Activate"}
                </Button>
              </span>
            ),
          },
        ]
      : []),
  ];

  return (
    <UdozoShell section="connect" current="/connect/visitors" crumbs={[{ label: "Connect", href: "/connect/applications" }, { label: "Visitors" }]}>
      <PageHeader title="Visitors" description="Who visits an applicant's office before it is approved: Udozo's staff, or agents who finished Udozo's training." />
      <div className="mt-6 space-y-4">
        {acts ? <AddVisitor /> : null}
        <div className="flex flex-wrap items-end gap-3">
          <MarketFilter id="visitors-market" value={country} onChange={setCountry} />
        </div>
        {updateState.error ? <Notice tone="red">{errorMessage(updateState.error)}</Notice> : null}
        <Card>
          <DataTable<ConnectVisitor>
            caption="Visitors"
            columns={columns}
            rows={visitors.data?.data}
            loading={visitors.isLoading}
            error={visitors.error ? errorMessage(visitors.error) : null}
            onRetry={visitors.refetch}
            rowKey={row => row.id}
            empty="No visitors yet."
          />
        </Card>
      </div>
    </UdozoShell>
  );
}
