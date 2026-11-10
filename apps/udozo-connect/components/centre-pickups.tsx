"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition } from "react";
import { compressImage } from "@bitocard/ui/image";
import { handOverPickup, removePickupPhoto } from "@/lib/centre-actions";
import { day, type FinalReturnAddress, type Pickup, pickupPhotoUrl, pickupStatusWords } from "@/lib/centres";
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
 * One pickup: the items Udozo's collector takes, ticked as they are handed over, check-out photos of what leaves (at
 * least one), then the collector's pickup code (the centre's proof it gave them to Udozo). Items left unticked stay for
 * the next pickup.
 */
export function PickupCard({ centre, pickup }: { centre: string; pickup: Pickup }) {
  const router = useRouter();
  const ids = useId();
  const waiting = pickup.items.filter(item => item.status === "waiting");
  const [given, setGiven] = useState<Set<string>>(() => new Set(waiting.map(item => item.order_id)));
  const [code, setCode] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const [photos, setPhotos] = useState(pickup.photos ?? []);
  const [sending, setSending] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const [confirm, dialog] = useConfirm();
  const addPhoto = async (chosen: File) => {
    setSending(true);
    setProblem(null);
    try {
      const prepared = await compressImage(chosen).catch(() => chosen);
      const body = new FormData();
      body.append("file", prepared, chosen.name || "photo.jpg");
      const res = await fetch(`/api/centres/${centre}/pickups/${pickup.id}/photos`, { method: "POST", body, credentials: "same-origin" });
      const json = (await res.json().catch(() => null)) as { pickup?: Pickup; error?: { message?: string } } | null;
      if (res.ok && json?.pickup) setPhotos(json.pickup.photos);
      else setProblem(json?.error?.message ?? "The photo could not be added. Try again.");
    } catch {
      setProblem("The photo could not be sent. Check your connection and try again.");
    } finally {
      setSending(false);
      if (file.current) file.current.value = "";
    }
  };
  const removePhoto = (photo: string) =>
    start(async () => {
      const result = await removePickupPhoto(centre, pickup.id, photo);
      if (!result.ok) return setProblem(result.message);
      setPhotos(result.data.photos);
    });
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
          <div className="mt-3">
            <p className={label}>Check-out photos</p>
            <p className="text-sm text-slate-600">Photograph what you give the collector, with its labels where you can: they are the record of what left the centre.</p>
            {photos.length ? (
              <ul className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
                {photos.map((photo, index) => (
                  <li key={photo.id} className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element -- a private photo read through this site's server */}
                    <img src={pickupPhotoUrl(centre, pickup.id, photo.id)} alt={`Check-out photo ${index + 1}`} className="aspect-square w-full rounded-xl object-cover" />
                    <button type="button" disabled={busy} onClick={() => removePhoto(photo.id)} className="absolute right-1 top-1 rounded-full bg-white/90 px-2 text-xs font-semibold text-navy-900">
                      Remove<span className="sr-only"> photo {index + 1}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <input
              ref={file}
              type="file"
              accept="image/jpeg,image/png"
              capture="environment"
              className="sr-only"
              aria-label="Add a check-out photo"
              onChange={event => {
                const chosen = event.target.files?.[0];
                if (chosen) void addPhoto(chosen);
              }}
            />
            <button type="button" disabled={sending || photos.length >= 8} onClick={() => file.current?.click()} className="mt-2 min-h-11 rounded-xl border border-navy-300 px-4 font-semibold text-navy-900 disabled:opacity-60">
              {sending ? "Sending…" : "Add a photo"}
            </button>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <div>
              <label htmlFor={`${ids}-code`} className={label}>
                The collector&apos;s pickup code
              </label>
              <input id={`${ids}-code`} inputMode="numeric" autoComplete="off" maxLength={7} value={code} onChange={event => setCode(event.target.value)} className={input} />
            </div>
            <button type="button" disabled={busy || !given.size || !photos.length} onClick={handOver} className={primary}>
              Hand over
            </button>
          </div>
          {!photos.length ? <p className="mt-2 text-sm text-slate-600">Add a check-out photo before you hand over.</p> : null}
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
