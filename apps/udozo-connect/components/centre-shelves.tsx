"use client";

import { useId, useState, useTransition } from "react";
import { addShelf, updateShelf } from "@/lib/centre-actions";
import { type Centre, canManage, type Shelf } from "@/lib/centres";
import { input, label, Panel, primary, Problem, secondary } from "./centre-ui";

type Draft = { code: string; label: string; capacity: string };
const blank: Draft = { code: "", label: "", capacity: "" };
const draftOf = (shelf: Shelf): Draft => ({ code: shelf.code, label: shelf.label ?? "", capacity: shelf.capacity === null ? "" : String(shelf.capacity) });

/**
 * The centre's storage places (shelves, racks, a back room): every item goes into one when it is received, so staff
 * always know where it is. Owners and managers add and change them; one no longer used is switched off, never deleted,
 * so what it held stays on record.
 */
export function CentreShelves({ centre, shelves }: { centre: Pick<Centre, "id" | "role" | "status">; shelves: Shelf[] }) {
  const ids = useId();
  const [places, setPlaces] = useState(shelves);
  const [draft, setDraft] = useState<Draft>(blank);
  const [editing, setEditing] = useState<{ id: string; draft: Draft } | null>(null);
  const [problem, setProblem] = useState<{ message: string; param: string | null } | null>(null);
  const [busy, start] = useTransition();
  const manages = canManage(centre.role) && centre.status !== "closed";

  const take = (result: Awaited<ReturnType<typeof addShelf>>, after?: () => void) => {
    if (result.ok) {
      setPlaces(result.data.data);
      setProblem(null);
      after?.();
    } else setProblem({ message: result.message, param: result.param });
  };

  const add = (event: React.FormEvent) => {
    event.preventDefault();
    start(async () => take(await addShelf(centre.id, { code: draft.code, label: draft.label || null, capacity: draft.capacity || null }), () => setDraft(blank)));
  };

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    if (!editing) return;
    const { id, draft: changed } = editing;
    start(async () => take(await updateShelf(centre.id, id, { code: changed.code, label: changed.label || null, capacity: changed.capacity || null }), () => setEditing(null)));
  };

  const toggle = (shelf: Shelf) => start(async () => take(await updateShelf(centre.id, shelf.id, { active: !shelf.active })));

  const fields = (value: Draft, change: (next: Draft) => void, prefix: string) => (
    <>
      <label className={label} htmlFor={`${prefix}-code`}>
        Code
        <input
          id={`${prefix}-code`}
          className={`${input} uppercase`}
          value={value.code}
          onChange={event => change({ ...value, code: event.target.value })}
          maxLength={20}
          required
          placeholder="A-01"
          aria-invalid={problem?.param === "code" ? true : undefined}
        />
      </label>
      <label className={label} htmlFor={`${prefix}-label`}>
        Description (optional)
        <input id={`${prefix}-label`} className={input} value={value.label} onChange={event => change({ ...value, label: event.target.value })} maxLength={60} placeholder="Front shelf" />
      </label>
      <label className={label} htmlFor={`${prefix}-capacity`}>
        Holds (optional)
        <input
          id={`${prefix}-capacity`}
          className={input}
          value={value.capacity}
          onChange={event => change({ ...value, capacity: event.target.value })}
          inputMode="numeric"
          placeholder="20"
          aria-invalid={problem?.param === "capacity" ? true : undefined}
        />
      </label>
    </>
  );

  return (
    <div className="grid gap-5">
      <Problem message={problem?.message ?? null} />
      <Panel title="Storage places">
        {places.length ? (
          <ul className="divide-y divide-slate-100">
            {places.map(shelf =>
              editing?.id === shelf.id ? (
                <li key={shelf.id} className="py-3">
                  <form onSubmit={save} className="grid gap-3 sm:grid-cols-3" aria-label={`Change ${shelf.code}`}>
                    {fields(editing.draft, next => setEditing({ id: shelf.id, draft: next }), `${ids}-${shelf.id}`)}
                    <div className="flex flex-wrap gap-2 sm:col-span-3">
                      <button type="submit" className={primary} disabled={busy}>
                        Save
                      </button>
                      <button type="button" className={secondary} onClick={() => setEditing(null)}>
                        Cancel
                      </button>
                    </div>
                  </form>
                </li>
              ) : (
                <li key={shelf.id} className={`flex flex-wrap items-center justify-between gap-3 py-3 ${shelf.active ? "" : "opacity-60"}`}>
                  <span className="min-w-0">
                    <strong className="block text-navy-900">
                      {shelf.code}
                      {shelf.active ? "" : " (not in use)"}
                    </strong>
                    <span className="block text-sm text-slate-600">
                      {shelf.label ?? "No description"}
                      {shelf.capacity ? ` · holds ${shelf.capacity}` : ""}
                    </span>
                  </span>
                  {manages ? (
                    <span className="flex flex-wrap gap-2">
                      <button type="button" className={`${secondary} min-h-10 px-3 text-sm`} disabled={busy} onClick={() => setEditing({ id: shelf.id, draft: draftOf(shelf) })}>
                        Change<span className="sr-only"> {shelf.code}</span>
                      </button>
                      <button type="button" className={`${secondary} min-h-10 px-3 text-sm`} disabled={busy} onClick={() => toggle(shelf)}>
                        {shelf.active ? "Stop using" : "Use again"}
                        <span className="sr-only"> {shelf.code}</span>
                      </button>
                    </span>
                  ) : null}
                </li>
              ),
            )}
          </ul>
        ) : (
          <p>No storage places yet.{manages ? " Add the first below." : " The centre's owner or a manager sets them up."}</p>
        )}
      </Panel>

      {manages ? (
        <Panel title="Add a storage place">
          <p className="text-sm">Give each one a short code you can write on it: a shelf number, a rack, a room.</p>
          <form onSubmit={add} className="mt-4 grid gap-3 sm:grid-cols-3">
            {fields(draft, setDraft, `${ids}-new`)}
            <div className="sm:col-span-3">
              <button type="submit" className={primary} disabled={busy || !draft.code.trim()}>
                Add storage place
              </button>
            </div>
          </form>
        </Panel>
      ) : null}
    </div>
  );
}
