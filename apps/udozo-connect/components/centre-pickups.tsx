"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { handOverPickup } from "@/lib/centre-actions";
import { day, type FinalReturnAddress, type Pickup, pickupStatusWords } from "@/lib/centres";
import { useConfirm } from "./confirm-dialog";
import { input, label, Panel, primary, Problem } from "./centre-ui";

/** Where the centre's abandoned items go, how many wait, and the next pickup. */
export function FraPanel({ fra }: { fra: FinalReturnAddress }) {
  return (
    <Panel title="Final Return Address">
      {fra.warehouse ? (
        <p>
          <strong className="text-navy-900">{fra.warehouse.name}</strong>
          <span className="block text-sm text-slate-600">
            {fra.warehouse.address}, {fra.warehouse.state.name} · {fra.warehouse.hours} · {fra.warehouse.phone}
          </span>
        </p>
      ) : (
        <p className="text-slate-600">Udozo has not set your Final Return Address yet.</p>
      )}
      <p className="mt-2 text-sm text-slate-600">
        {fra.awaiting_pickup === 1 ? "1 abandoned item waits" : `${fra.awaiting_pickup} abandoned items wait`} for Udozo&apos;s pickup
        {fra.next_pickup ? `, next on ${day(`${fra.next_pickup.day}T00:00:00.000Z`)} with ${fra.next_pickup.collector}` : ""}. Keep them safe until then: you never send them yourselves.
      </p>
    </Panel>
  );
}

/**
 * One pickup: the items Udozo's collector takes, ticked as they are handed over, then the collector's pickup code (the
 * centre's proof it gave them to Udozo). Items left unticked stay for the next pickup.
 */
export function PickupCard({ centre, pickup }: { centre: string; pickup: Pickup }) {
  const router = useRouter();
  const ids = useId();
  const waiting = pickup.items.filter(item => item.status === "waiting");
  const [given, setGiven] = useState<Set<string>>(() => new Set(waiting.map(item => item.order_id)));
  const [code, setCode] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const [confirm, dialog] = useConfirm();
  const toggle = (id: string) =>
    setGiven(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const handOver = async () => {
    const left = waiting.length - given.size;
    const ok = await confirm({
      title: `Hand ${given.size === 1 ? "1 item" : `${given.size} items`} to ${pickup.collector}?`,
      body: left ? `${left === 1 ? "1 item stays" : `${left} items stay`} here for the next pickup. Once handed over, Udozo is responsible for them.` : "Once handed over, Udozo is responsible for them.",
      action: "Hand over",
    });
    if (!ok) return;
    start(async () => {
      const result = await handOverPickup(centre, pickup.id, code, [...given]);
      if (!result.ok) return setProblem(result.message);
      setProblem(null);
      router.refresh();
    });
  };
  const shown = pickup.items.filter(item => item.status !== "removed");
  return (
    <Panel title={`${pickup.number} · ${day(`${pickup.day}T00:00:00.000Z`)}`}>
      {dialog}
      <p className="text-sm text-slate-600">
        {pickupStatusWords[pickup.status]} · {pickup.collector} for {pickup.warehouse.name}
      </p>
      {pickup.status === "scheduled" ? (
        <>
          <ul className="mt-3 grid gap-1">
            {waiting.map(item => (
              <li key={item.order_id}>
                <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-2 hover:bg-slate-50">
                  <input type="checkbox" checked={given.has(item.order_id)} onChange={() => toggle(item.order_id)} className="size-5 shrink-0 accent-navy-900" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-navy-900">{item.title}</span>
                    <span className="text-sm text-slate-600">
                      {item.number}
                      {item.shelf ? ` · on ${item.shelf}` : ""}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <div>
              <label htmlFor={`${ids}-code`} className={label}>
                The collector&apos;s pickup code
              </label>
              <input id={`${ids}-code`} inputMode="numeric" autoComplete="off" maxLength={7} value={code} onChange={event => setCode(event.target.value)} className={input} />
            </div>
            <button type="button" disabled={busy || !given.size} onClick={handOver} className={primary}>
              Hand over
            </button>
          </div>
        </>
      ) : (
        <ul className="mt-3 grid gap-1 text-sm">
          {shown.map(item => (
            <li key={item.order_id} className="flex justify-between gap-2">
              <span className="min-w-0 truncate">
                {item.title} <span className="text-slate-500">{item.number}</span>
              </span>
              <span className="shrink-0 text-slate-600">{item.status === "received" ? "At the warehouse" : item.status === "missing" ? "Did not arrive" : "With Udozo"}</span>
            </li>
          ))}
        </ul>
      )}
      <Problem message={problem} />
    </Panel>
  );
}
