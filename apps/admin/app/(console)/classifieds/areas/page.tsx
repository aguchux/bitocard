"use client";

import { useId, useState, type FormEvent } from "react";
import { Badge, Button, Card, CardHeader, errorMessage, Field, formatNumber, Input, Notice, PageHeader, QueryView, Select, Skeleton, Toggle } from "@bitocard/admin-ui";
import { AdminShell, can, useAdmin } from "@bitocard/admin-ui/shell";
import { type AdminClassifiedArea, type AdminClassifiedState, useClassifiedAreasQuery, useCreateClassifiedAreaMutation, useUpdateClassifiedAreaMutation } from "@bitocard/api-client/admin";
import { MarketFilter } from "@/components/classifieds";

const coordinate = (value: string, limit: number) => {
  const number = Number(value.trim());
  return value.trim() !== "" && Number.isFinite(number) && Math.abs(number) <= limit ? number : null;
};

/**
 * BitoCard Shop > Areas: each market's states with their cities and areas, which sellers pick and buyers search near.
 * Centre points are public map data (never anyone's position), used only to order nearby areas. Operations correct
 * names and centre points, add areas, or switch one off (no new ads there; live ads keep it). Addresses never change.
 */
export default function ClassifiedAreasPage() {
  const admin = useAdmin();
  const [country, setCountry] = useState("NG");
  const areas = useClassifiedAreasQuery(country);
  const [open, setOpen] = useState<string | null>(null);
  const changes = can(admin, "operations");

  return (
    <AdminShell section="classifieds" current="/classifieds/areas" crumbs={[{ label: "BitoCard Shop", href: "/classifieds" }, { label: "Areas" }]}>
      <PageHeader
        title="Areas"
        description="States, then cities and areas. Results run local first, so each centre point decides which areas count as nearby. Renaming keeps the address, so links keep working."
        actions={<MarketFilter id="areas-market" value={country} onChange={setCountry} all={false} />}
      />
      <div className="mt-6 grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <QueryView query={areas} loading={<Skeleton className="h-96 w-full" />}>
          {data => (
            <ul className="space-y-3">
              {data.data.map(state => (
                <li key={state.id}>
                  <StateCard state={state} country={country} changes={changes} expanded={open === state.id} onToggle={() => setOpen(open === state.id ? null : state.id)} />
                </li>
              ))}
            </ul>
          )}
        </QueryView>
        {changes ? <AddArea country={country} states={areas.data?.data ?? []} /> : null}
      </div>
    </AdminShell>
  );
}

function StateCard({ state, country, changes, expanded, onToggle }: { state: AdminClassifiedState; country: string; changes: boolean; expanded: boolean; onToggle: () => void }) {
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3 px-5 py-4 sm:px-6">
        <button type="button" onClick={onToggle} aria-expanded={expanded} className="min-w-0 flex-1 text-left">
          <span className="block font-semibold text-ink">{state.name}</span>
          <span className="block text-xs text-muted">
            {state.areas.length} cities and areas · {formatNumber(state.active_listings)} live ads
          </span>
        </button>
        {!state.enabled ? <Badge tone="grey">Off</Badge> : null}
        <Button size="sm" variant="ghost" onClick={onToggle}>
          {expanded ? "Close" : "Open"}
        </Button>
      </div>
      {expanded ? (
        <div className="space-y-2 border-t border-line px-5 py-4 sm:px-6">
          <AreaRow area={state} country={country} changes={changes} />
          {state.areas.map(area => (
            <AreaRow key={area.id} area={area} country={country} changes={changes} />
          ))}
        </div>
      ) : null}
    </Card>
  );
}

/** One state or area: its name and centre point, saved together, and its switch. */
function AreaRow({ area, country, changes }: { area: AdminClassifiedArea; country: string; changes: boolean }) {
  const id = useId();
  const [name, setName] = useState(area.name);
  const [latitude, setLatitude] = useState(String(area.latitude));
  const [longitude, setLongitude] = useState(String(area.longitude));
  const [update, updating] = useUpdateClassifiedAreaMutation();
  const lat = coordinate(latitude, 90);
  const lng = coordinate(longitude, 180);
  const changed = name.trim() !== area.name || lat !== area.latitude || lng !== area.longitude;
  const valid = name.trim().length >= 2 && lat !== null && lng !== null;

  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!valid || !changed) return;
    void update({ id: area.id, country, name: name.trim(), latitude: lat!, longitude: lng! });
  };

  return (
    <form onSubmit={save} className="rounded-xl border border-line p-3">
      <div className="flex flex-wrap items-end gap-3">
        <Field label={area.kind === "state" ? "State" : "City or area"} htmlFor={`${id}-name`}>
          <Input id={`${id}-name`} disabled={!changes} value={name} onChange={event => setName(event.target.value)} className="w-48" />
        </Field>
        <Field label="Latitude" htmlFor={`${id}-lat`}>
          <Input id={`${id}-lat`} disabled={!changes} inputMode="decimal" value={latitude} onChange={event => setLatitude(event.target.value)} className="w-28" />
        </Field>
        <Field label="Longitude" htmlFor={`${id}-lng`}>
          <Input id={`${id}-lng`} disabled={!changes} inputMode="decimal" value={longitude} onChange={event => setLongitude(event.target.value)} className="w-28" />
        </Field>
        <span className="flex items-center gap-2 pb-2.5 text-xs font-semibold text-muted">
          On
          <Toggle label={`${area.name} on`} checked={area.enabled} disabled={!changes} onChange={enabled => void update({ id: area.id, country, enabled })} />
        </span>
        {changes ? (
          <Button type="submit" size="sm" variant="secondary" disabled={!valid || !changed} loading={updating.isLoading && updating.originalArgs?.enabled === undefined}>
            Save
          </Button>
        ) : null}
      </div>
      <p className="mt-2 text-xs text-muted">
        /{area.slug} · {formatNumber(area.active_listings)} live ads
        {!valid ? " · a name and a valid centre point are needed" : ""}
      </p>
      {updating.error ? (
        <div className="mt-2">
          <Notice tone="red">{errorMessage(updating.error)}</Notice>
        </div>
      ) : null}
    </form>
  );
}

function AddArea({ country, states }: { country: string; states: AdminClassifiedState[] }) {
  const id = useId();
  const [stateId, setStateId] = useState("");
  const [name, setName] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [create, creating] = useCreateClassifiedAreaMutation();
  const [added, setAdded] = useState<string | null>(null);
  const lat = coordinate(latitude, 90);
  const lng = coordinate(longitude, 180);
  const valid = name.trim().length >= 2 && lat !== null && lng !== null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    const area = await create({ country, ...(stateId ? { state_id: stateId } : {}), name: name.trim(), latitude: lat!, longitude: lng! }).unwrap();
    setAdded(area.name);
    setName("");
    setLatitude("");
    setLongitude("");
  };

  return (
    <Card>
      <CardHeader title="Add a city or area" description="Its centre point from public map data, in decimal degrees." />
      <form onSubmit={submit} className="space-y-3 px-5 pb-5 sm:px-6">
        <Field label="In" htmlFor={`${id}-state`}>
          <Select id={`${id}-state`} value={stateId} onChange={event => setStateId(event.target.value)}>
            <option value="">A new state</option>
            {states.map(state => (
              <option key={state.id} value={state.id}>
                {state.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Name" htmlFor={`${id}-name`}>
          <Input id={`${id}-name`} maxLength={60} value={name} onChange={event => setName(event.target.value)} placeholder="e.g. Ojodu Berger" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Latitude" htmlFor={`${id}-lat`}>
            <Input id={`${id}-lat`} inputMode="decimal" value={latitude} onChange={event => setLatitude(event.target.value)} placeholder="6.64" />
          </Field>
          <Field label="Longitude" htmlFor={`${id}-lng`}>
            <Input id={`${id}-lng`} inputMode="decimal" value={longitude} onChange={event => setLongitude(event.target.value)} placeholder="3.37" />
          </Field>
        </div>
        {creating.error ? <Notice tone="red">{errorMessage(creating.error)}</Notice> : null}
        {added ? <Notice tone="green">{added} added.</Notice> : null}
        <Button type="submit" loading={creating.isLoading} disabled={!valid}>
          {stateId ? "Add area" : "Add state"}
        </Button>
      </form>
    </Card>
  );
}
