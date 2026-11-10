"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { pauseCentre, resumeCentre, updateCentre } from "@/lib/centre-actions";
import { type Centre, canManage, day, pauseWords } from "@/lib/centres";
import { useConfirm } from "./confirm-dialog";
import { input, label, Panel, primary, Problem, secondary } from "./centre-ui";

type Fault = { message: string; param: string | null } | null;

/** Open the centre again after the partner's own pause (owners and managers). */
export function ResumeButton({ id, className = "" }: { id: string; className?: string }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <div className={className}>
      <button
        type="button"
        className={primary}
        disabled={busy}
        onClick={() =>
          start(async () => {
            const result = await resumeCentre(id);
            if (result.ok) router.refresh();
            else setProblem(result.message);
          })
        }
      >
        Open again
      </button>
      <div className="mt-2">
        <Problem message={problem} />
      </div>
    </div>
  );
}

/** The centre's details (hours, phone, capacity, landmark) and its holiday pause; staff see them without changing them. */
export function CentreSettings({ centre }: { centre: Centre }) {
  const router = useRouter();
  const ids = useId();
  const [busy, start] = useTransition();
  const [confirm, dialog] = useConfirm();
  const [fault, setFault] = useState<Fault>(null);
  const [saved, setSaved] = useState(false);
  const [fields, setFields] = useState({ hours: centre.hours, phone: centre.phone, capacity: String(centre.capacity), landmark: centre.landmark ?? "" });
  const [until, setUntil] = useState("");
  const [note, setNote] = useState("");
  // The earliest day it can open again: tomorrow, worked out once.
  const [tomorrow] = useState(() => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10));
  const manages = canManage(centre.role);
  const closed = centre.status === "closed";
  const editable = manages && !closed;
  const stopped = pauseWords(centre, day);

  const set = (key: keyof typeof fields) => (event: React.ChangeEvent<HTMLInputElement>) => {
    setFields(current => ({ ...current, [key]: event.target.value }));
    setSaved(false);
  };
  const invalid = (param: string) => (fault?.param === param ? true : undefined);

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    start(async () => {
      const result = await updateCentre(centre.id, fields);
      if (result.ok) {
        setFault(null);
        setSaved(true);
        router.refresh();
      } else setFault({ message: result.message, param: result.param });
    });
  };

  const pause = async (event: React.FormEvent) => {
    event.preventDefault();
    const answer = await confirm({
      title: "Pause your centre?",
      body: `Sellers cannot send new items here while it is paused. Items already on their way or on your shelves stay your responsibility until they are collected.${until ? ` It opens again on ${day(`${until}T00:00:00.000Z`)}.` : " It stays paused until you open it again."}`,
      action: "Pause centre",
      dismiss: "Keep it open",
    });
    if (!answer) return;
    start(async () => {
      const result = await pauseCentre(centre.id, until || null, note || null);
      if (result.ok) {
        setFault(null);
        setUntil("");
        setNote("");
        router.refresh();
      } else setFault({ message: result.message, param: result.param });
    });
  };


  return (
    <div className="grid gap-5">
      {dialog}
      <Problem message={fault?.message ?? null} />
      <Panel title="Your centre's details">
        {!manages ? <p className="mb-3 text-sm">Only the centre&apos;s owner and managers can change these.</p> : null}
        <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
          <label className={`${label} sm:col-span-2`} htmlFor={`${ids}-hours`}>
            Opening hours
            <input id={`${ids}-hours`} className={input} value={fields.hours} onChange={set("hours")} disabled={!editable} maxLength={200} aria-invalid={invalid("hours")} />
          </label>
          <label className={label} htmlFor={`${ids}-phone`}>
            Phone
            <input id={`${ids}-phone`} className={input} value={fields.phone} onChange={set("phone")} disabled={!editable} inputMode="tel" autoComplete="tel" aria-invalid={invalid("phone")} />
          </label>
          <label className={label} htmlFor={`${ids}-capacity`}>
            How many items it can hold
            <input id={`${ids}-capacity`} className={input} value={fields.capacity} onChange={set("capacity")} disabled={!editable} inputMode="numeric" aria-invalid={invalid("capacity")} />
          </label>
          <label className={`${label} sm:col-span-2`} htmlFor={`${ids}-landmark`}>
            Landmark (optional)
            <input id={`${ids}-landmark`} className={input} value={fields.landmark} onChange={set("landmark")} disabled={!editable} maxLength={120} aria-invalid={invalid("landmark")} />
          </label>
          {editable ? (
            <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
              <button type="submit" className={primary} disabled={busy}>
                Save
              </button>
              {saved ? (
                <span className="text-sm font-semibold text-emerald-700" role="status">
                  Saved
                </span>
              ) : null}
            </div>
          ) : null}
        </form>
        <p className="mt-4 text-sm">
          Your office&apos;s address and its place on the map are set by Udozo. To move, write to Udozo&apos;s team from udozo.com.
        </p>
      </Panel>

      {manages && !closed ? (
        centre.status === "paused" ? (
          <Panel title="Paused" tone="warn">
            <p>{stopped}</p>
            {centre.paused?.by === "partner" ? <ResumeButton id={centre.id} className="mt-3" /> : null}
          </Panel>
        ) : (
          <Panel title="Going on holiday?">
            <p>Pause your centre so no new items are sent here. You keep looking after what you already hold.</p>
            <form onSubmit={pause} className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className={label} htmlFor={`${ids}-until`}>
                Open again on (optional)
                <input id={`${ids}-until`} type="date" min={tomorrow} className={input} value={until} onChange={event => setUntil(event.target.value)} aria-invalid={invalid("until")} />
              </label>
              <label className={label} htmlFor={`${ids}-note`}>
                Note (optional)
                <input id={`${ids}-note`} className={input} value={note} onChange={event => setNote(event.target.value)} maxLength={200} placeholder="Closed for a holiday" />
              </label>
              <div className="sm:col-span-2">
                <button type="submit" className={secondary} disabled={busy}>
                  Pause centre
                </button>
              </div>
            </form>
          </Panel>
        )
      ) : null}
    </div>
  );
}
