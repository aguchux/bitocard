"use client";

import { useId, useState } from "react";
import { Megaphone, Plus } from "lucide-react";
import { ActionDialog, Badge, Button, Card, CardHeader, DataTable, Dialog, errorMessage, Field, formatDateTime, Input, Notice, PageHeader, QueryView, Select, Skeleton, Textarea } from "@bitocard/admin-ui";
import { can, useAdmin } from "@bitocard/admin-ui/shell";
import { type SponsoredInput, type SponsoredPlacement, type SponsoredState, useCreateSponsoredMutation, useEndSponsoredMutation, useHomePagesQuery, useSponsoredPlacementsQuery, useUpdateSponsoredMutation } from "@bitocard/api-client/admin";
import { UdozoShell } from "@/components/shell";

const stateTones: Record<SponsoredState, "green" | "blue" | "grey"> = { active: "green", scheduled: "blue", ended: "grey" };
const stateLabels: Record<SponsoredState, string> = { active: "Showing", scheduled: "Scheduled", ended: "Ended" };

/** A date and time as the browser's datetime-local field wants it, in the admin's own time. */
const local = (iso: string) => {
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
const inDays = (days: number) => local(new Date(Date.now() + days * 86_400_000).toISOString());

function PlacementForm({ pages, placement, onDone }: { pages: Array<{ page: string; name: string }>; placement: SponsoredPlacement | null; onDone: () => void }) {
  const id = useId();
  const [create, created] = useCreateSponsoredMutation();
  const [update, updated] = useUpdateSponsoredMutation();
  const [ref, setRef] = useState(placement ? String(placement.listing.ref) : "");
  const [page, setPage] = useState(placement ? (placement.country ?? "global") : (pages.find(item => item.page !== "global")?.page ?? "global"));
  const [startsAt, setStartsAt] = useState(placement ? local(placement.starts_at) : inDays(0));
  const [endsAt, setEndsAt] = useState(placement ? local(placement.ends_at) : inDays(7));
  const [position, setPosition] = useState(String(placement?.position ?? 0));
  const [note, setNote] = useState(placement?.note ?? "");
  const state = placement ? updated : created;
  const failure = (state.error ?? null) as { param?: string } | null;
  const errorFor = (param: string) => (failure?.param === param ? errorMessage(state.error) : undefined);
  const submit = async () => {
    const body: SponsoredInput = { country: page === "global" ? null : page, starts_at: new Date(startsAt).toISOString(), ends_at: new Date(endsAt).toISOString(), position: Number(position) || 0, note: note.trim() || null };
    const done = placement ? update({ id: placement.id, ...body }) : create({ ...body, listing_ref: Number(ref) });
    if (await done.unwrap().then(() => true).catch(() => false)) onDone();
  };
  return (
    <form
      className="grid gap-4"
      onSubmit={event => {
        event.preventDefault();
        void submit();
      }}
    >
      {placement ? null : (
        <Field label="Listing number" htmlFor={`${id}-ref`} hint="The number in its address: udozo.com/ng/l/100028-… is 100028. It must be for sale on Udozo." error={errorFor("listing_ref")}>
          <Input id={`${id}-ref`} inputMode="numeric" value={ref} onChange={event => setRef(event.target.value.replace(/\D/g, ""))} required />
        </Field>
      )}
      <Field label="Home page" htmlFor={`${id}-page`} hint="A country’s page shows only its own listings; across countries, any market’s." error={errorFor("country")}>
        <Select id={`${id}-page`} value={page} onChange={event => setPage(event.target.value)}>
          {pages.map(item => (
            <option key={item.page} value={item.page}>
              {item.name}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Starts" htmlFor={`${id}-starts`} error={errorFor("starts_at")}>
          <Input id={`${id}-starts`} type="datetime-local" value={startsAt} onChange={event => setStartsAt(event.target.value)} required />
        </Field>
        <Field label="Ends" htmlFor={`${id}-ends`} hint="At most 90 days after it starts." error={errorFor("ends_at")}>
          <Input id={`${id}-ends`} type="datetime-local" value={endsAt} onChange={event => setEndsAt(event.target.value)} required />
        </Field>
      </div>
      <Field label="Position" htmlFor={`${id}-position`} hint="Lower shows first.">
        <Input id={`${id}-position`} type="number" min={0} value={position} onChange={event => setPosition(event.target.value)} />
      </Field>
      <Field label="Note" htmlFor={`${id}-note`} hint="Optional, for the team: who it is for, what was agreed.">
        <Textarea id={`${id}-note`} value={note} maxLength={300} onChange={event => setNote(event.target.value)} />
      </Field>
      {state.error && !failure?.param?.match(/^(listing_ref|country|starts_at|ends_at)$/) ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={state.isLoading} icon={<Megaphone className="size-4" aria-hidden />}>
          {placement ? "Save placement" : "Place it"}
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function Placements({ pages, editable }: { pages: Array<{ page: string; name: string }>; editable: boolean }) {
  const [page, setPage] = useState("");
  const [state, setState] = useState<SponsoredState | "">("active");
  const placements = useSponsoredPlacementsQuery({ country: page || undefined, state: state || undefined });
  const [end] = useEndSponsoredMutation();
  const [form, setForm] = useState<SponsoredPlacement | "new" | null>(null);
  const [ending, setEnding] = useState<SponsoredPlacement | null>(null);
  const name = (country: string | null) => pages.find(item => item.page === (country ?? "global"))?.name ?? country ?? "All countries";
  return (
    <Card>
      <CardHeader
        title="Placements"
        description="Each shows in its home page’s Sponsored section while it runs, always labelled Sponsored. Pages show changes within a minute."
        actions={editable ? <Button icon={<Plus className="size-4" aria-hidden />} onClick={() => setForm("new")}>Place a listing</Button> : undefined}
      />
      <div className="flex flex-wrap gap-3 px-5 pb-4 sm:px-6">
        <Select aria-label="Home page" value={page} onChange={event => setPage(event.target.value)} className="w-auto">
          <option value="">Every page</option>
          {pages.map(item => (
            <option key={item.page} value={item.page.toLowerCase() === "global" ? "global" : item.page}>
              {item.name}
            </option>
          ))}
        </Select>
        <Select aria-label="State" value={state} onChange={event => setState(event.target.value as SponsoredState | "")} className="w-auto">
          <option value="">Any state</option>
          <option value="active">Showing now</option>
          <option value="scheduled">Scheduled</option>
          <option value="ended">Ended</option>
        </Select>
      </div>
      <QueryView query={placements} loading={<Skeleton className="m-5 h-32" />}>
        {data => (
          <DataTable
            rows={data.data}
            rowKey={row => row.id}
            empty="No placements here."
            columns={[
              { key: "listing", header: "Listing", cell: row => <span className="font-semibold">{`${row.listing.title ?? "Untitled"} (${row.listing.ref})`}{row.listing.live ? null : <Badge tone="amber">Not for sale: not shown</Badge>}</span> },
              { key: "page", header: "Home page", cell: row => name(row.country) },
              { key: "when", header: "When", cell: row => `${formatDateTime(row.starts_at)} – ${formatDateTime(row.ends_at)}` },
              { key: "position", header: "Position", cell: row => row.position },
              { key: "state", header: "State", cell: row => <Badge tone={stateTones[row.state]}>{stateLabels[row.state]}</Badge> },
              {
                key: "actions",
                header: "Actions",
                cell: row =>
                  editable && row.state !== "ended" ? (
                    <span className="flex gap-2">
                      <Button size="sm" variant="secondary" onClick={() => setForm(row)}>Edit</Button>
                      <Button size="sm" variant="ghost" onClick={() => setEnding(row)}>End now</Button>
                    </span>
                  ) : null,
              },
            ]}
          />
        )}
      </QueryView>
      <Dialog open={form !== null} onClose={() => setForm(null)} title={form === "new" ? "Place a listing" : "Change the placement"}>
        {form !== null ? <PlacementForm pages={pages} placement={form === "new" ? null : form} onDone={() => setForm(null)} /> : null}
      </Dialog>
      <ActionDialog
        open={ending !== null}
        onClose={() => setEnding(null)}
        title="End this placement now?"
        description="It leaves the home page within a minute and is kept for the record."
        confirmLabel="End now"
        tone="danger"
        requireReason={false}
        onConfirm={async () => void (await end(ending!.id).unwrap())}
      />
    </Card>
  );
}

export default function SponsoredPage() {
  const admin = useAdmin();
  const editable = can(admin, "operations");
  const pages = useHomePagesQuery();
  return (
    <UdozoShell section="theme" current="/sponsored" crumbs={[{ label: "Site", href: "/home-pages" }, { label: "Sponsored" }]}>
      <PageHeader title="Sponsored" description="Listings Udozo’s team places on the home pages, for a set time. Visitors always see them labelled Sponsored, never mixed in as ordinary results." />
      {!editable ? <Notice tone="grey">Only operations admins place listings.</Notice> : null}
      <QueryView query={pages} loading={<Skeleton className="h-48 w-full" />}>
        {data => <Placements pages={data.data.map(item => ({ page: item.page, name: item.name }))} editable={editable} />}
      </QueryView>
    </UdozoShell>
  );
}
