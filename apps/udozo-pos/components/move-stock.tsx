"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { useConfirm } from "@/components/confirm-dialog";
import { type PosProduct, type PosStockTransfer, saleTime, transferStatusText } from "@/lib/pos";
import { moveStock, receiveStock, takeBackStock } from "@/lib/pos-actions";

const field = "mt-1 h-12 w-full rounded-xl border border-pos-line bg-white px-3 text-pos-ink focus:border-pos-600 focus:ring-2 focus:ring-pos-50 focus:outline-none";
const label = "block text-sm font-semibold text-pos-ink-2";
const online = "online";

type Line = { key: number; listing: string; quantity: string };

/** How many of a product a place holds: a shop's level, or what is in no shop (online). */
export const heldAt = (product: Pick<PosProduct, "levels">, place: string) => (place === online ? (product.levels?.online ?? 0) : (product.levels?.shops.find(level => level.shop_id === place)?.quantity ?? 0));

/**
 * Moving stock between shops, or between a shop and online (milestone 8): where it leaves and goes, then the products
 * and how many of each, never more than the place it leaves holds (Udozo checks again, with online orders' holds).
 */
export function MoveStock({ shops, products }: { shops: Array<{ id: string; name: string }>; products: PosProduct[] }) {
  const router = useRouter();
  const ids = useId();
  const [from, setFrom] = useState(shops[0]?.id ?? online);
  const [to, setTo] = useState(shops[1]?.id ?? online);
  const [lines, setLines] = useState<Line[]>([{ key: 1, listing: "", quantity: "1" }]);
  const [note, setNote] = useState("");
  const [transit, setTransit] = useState(false);
  const [state, setState] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, start] = useTransition();
  const places = [...shops.map(shop => ({ value: shop.id, label: shop.name })), { value: online, label: "Online (in no shop)" }];
  const placeName = (value: string) => places.find(place => place.value === value)?.label ?? value;
  const stocked = products.filter(product => heldAt(product, from) > 0);
  const update = (key: number, change: Partial<Line>) => setLines(current => current.map(line => (line.key === key ? { ...line, ...change } : line)));

  return (
    <form
      className="grid gap-4"
      onSubmit={event => {
        event.preventDefault();
        if (from === to) return setState({ ok: false, message: "Choose two different places." });
        const chosen = lines.filter(line => line.listing);
        if (!chosen.length) return setState({ ok: false, message: "Choose a product to move." });
        for (const line of chosen) {
          const quantity = Number(line.quantity);
          const product = products.find(item => item.id === line.listing)!;
          if (!Number.isInteger(quantity) || quantity < 1) return setState({ ok: false, message: "Move from 1 of each." });
          if (quantity > heldAt(product, from)) return setState({ ok: false, message: `${placeName(from)} has only ${heldAt(product, from)} of “${product.title}”.` });
        }
        start(async () => {
          const betweenShops = from !== online && to !== online;
          const result = await moveStock({ from: from === online ? null : from, to: to === online ? null : to, lines: chosen.map(line => ({ listing_id: line.listing, quantity: Number(line.quantity) })), note, ...(transit && betweenShops ? { inTransit: true } : {}) });
          if (!result.ok) return setState({ ok: false, message: result.message });
          setState({ ok: true, message: result.data.status === "in_transit" ? `${result.data.number}: ${result.data.units} on their way to ${result.data.to.name}, to check in when they arrive.` : `${result.data.number}: ${result.data.units} moved from ${result.data.from.name} to ${result.data.to.name}.` });
          setLines([{ key: Date.now(), listing: "", quantity: "1" }]);
          setNote("");
          router.refresh();
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={`${ids}-from`} className={label}>
            From
          </label>
          <select id={`${ids}-from`} value={from} onChange={event => setFrom(event.target.value)} className={field}>
            {places.map(place => (
              <option key={place.value} value={place.value}>
                {place.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${ids}-to`} className={label}>
            To
          </label>
          <select id={`${ids}-to`} value={to} onChange={event => setTo(event.target.value)} className={field}>
            {places.map(place => (
              <option key={place.value} value={place.value}>
                {place.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <fieldset className="grid gap-3">
        <legend className={label}>What to move</legend>
        {lines.map((line, index) => {
          const product = products.find(item => item.id === line.listing);
          return (
            <div key={line.key} className="grid gap-2 rounded-xl border border-pos-line p-3 sm:grid-cols-[minmax(0,1fr)_8rem_auto] sm:items-end">
              <div className="min-w-0">
                <label htmlFor={`${ids}-product-${line.key}`} className={label}>
                  Product {index + 1}
                </label>
                <select id={`${ids}-product-${line.key}`} value={line.listing} onChange={event => update(line.key, { listing: event.target.value })} className={field}>
                  <option value="">Choose a product</option>
                  {stocked.map(item => (
                    <option key={item.id} value={item.id}>
                      {item.title ?? "Untitled"} ({heldAt(item, from)} at {placeName(from)})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor={`${ids}-quantity-${line.key}`} className={label}>
                  How many
                </label>
                <input id={`${ids}-quantity-${line.key}`} inputMode="numeric" value={line.quantity} onChange={event => update(line.key, { quantity: event.target.value.replace(/\D/g, "") })} className={field} />
              </div>
              {lines.length > 1 ? (
                <button type="button" onClick={() => setLines(current => current.filter(item => item.key !== line.key))} className="h-12 rounded-xl border border-pos-line px-3 text-sm font-semibold">
                  Remove<span className="sr-only"> product {index + 1}</span>
                </button>
              ) : null}
              {product ? <p className="text-sm text-pos-muted sm:col-span-3">{placeName(from)} has {heldAt(product, from)}; {placeName(to)} has {heldAt(product, to)}.</p> : null}
            </div>
          );
        })}
        <button type="button" onClick={() => setLines(current => [...current, { key: Date.now(), listing: "", quantity: "1" }])} className="h-11 w-fit rounded-xl border border-pos-line bg-white px-4 text-sm font-semibold">
          Add another product
        </button>
      </fieldset>
      <div>
        <label htmlFor={`${ids}-note`} className={label}>
          Note (optional)
        </label>
        <input id={`${ids}-note`} value={note} onChange={event => setNote(event.target.value)} maxLength={300} placeholder="Weekend stock for Lekki" className={field} />
      </div>
      {from !== online && to !== online ? (
        <label className="flex items-start gap-3 rounded-xl border border-pos-line p-3">
          <input type="checkbox" checked={transit} onChange={event => setTransit(event.target.checked)} className="mt-1 size-5 accent-pos-600" />
          <span>
            <span className="block font-semibold text-pos-ink">It travels: {placeName(to)} checks it in when it arrives</span>
            <span className="block text-sm text-pos-ink-2">Until then neither shop nor udozo.com can sell it. Anything that does not arrive is written off.</span>
          </span>
        </label>
      ) : null}
      <button type="submit" disabled={pending} className="flex h-12 items-center justify-center rounded-xl bg-pos-600 px-6 font-bold text-white hover:bg-pos-700 disabled:opacity-60">
        {transit && from !== online && to !== online ? "Send stock" : "Move stock"}
      </button>
      {state ? (
        <p role={state.ok ? "status" : "alert"} className={state.ok ? "font-semibold text-pos-700" : "font-semibold text-pos-error"}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

/**
 * A transfer in the latest moves: where it went and what, and while it is on its way, **Check in** (what arrived of each
 * line; less than was sent is written off) and **Take back** (to the shop it left).
 */
export function TransferRow({ transfer, canAct }: { transfer: PosStockTransfer; canAct: boolean }) {
  const router = useRouter();
  const ids = useId();
  const [confirm, dialog] = useConfirm();
  const [checking, setChecking] = useState(false);
  const [arrived, setArrived] = useState<Record<string, string>>(() => Object.fromEntries(transfer.lines.map(line => [line.listing_id, String(line.quantity)])));
  const [state, setState] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, start] = useTransition();
  const waiting = transfer.status === "in_transit";
  return (
    <li className="grid gap-2 border-t border-pos-line pt-2 text-sm">
      <span className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-pos-ink">
          {transfer.number} · {transfer.from.name} to {transfer.to.name} · {transfer.units} {transfer.units === 1 ? "unit" : "units"}
        </span>
        {transfer.status ? <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${waiting ? "bg-pos-warn-bg text-pos-warn" : "bg-pos-50 text-pos-700"}`}>{transferStatusText(transfer)}</span> : null}
      </span>
      <span className="block text-pos-muted">
        {transfer.lines.map(line => `${line.title} × ${line.quantity}`).join(", ")} · {transfer.by}, {saleTime(transfer.created_at)}
        {transfer.note ? ` · ${transfer.note}` : ""}
      </span>
      {waiting && canAct ? (
        checking ? (
          <form
            className="grid gap-2 rounded-xl border border-pos-line p-3"
            onSubmit={event => {
              event.preventDefault();
              const lines = transfer.lines.map(line => ({ listing_id: line.listing_id, quantity: Number(arrived[line.listing_id] ?? line.quantity) }));
              if (lines.some((line, index) => !Number.isInteger(line.quantity) || line.quantity < 0 || line.quantity > transfer.lines[index]!.quantity)) return setState({ ok: false, message: "Each is between nothing and how many were sent." });
              start(async () => {
                const result = await receiveStock(transfer.id, lines);
                if (!result.ok) return setState({ ok: false, message: result.message });
                const lost = (result.data.received_lines ?? []).reduce((sum, line) => sum + line.lost, 0);
                setState({ ok: true, message: lost ? `Checked in. ${lost} written off as lost on the way.` : "Checked in." });
                setChecking(false);
                router.refresh();
              });
            }}
          >
            <p className="font-semibold text-pos-ink">How many arrived?</p>
            {transfer.lines.map(line => (
              <label key={line.listing_id} htmlFor={`${ids}-${line.listing_id}`} className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate">
                  {line.title} <span className="text-pos-muted">(sent {line.quantity})</span>
                </span>
                <input id={`${ids}-${line.listing_id}`} inputMode="numeric" value={arrived[line.listing_id] ?? ""} onChange={event => setArrived(current => ({ ...current, [line.listing_id]: event.target.value.replace(/\D/g, "") }))} className="h-11 w-20 rounded-xl border border-pos-line px-3 text-right" />
              </label>
            ))}
            <span className="flex flex-wrap gap-2">
              <button type="submit" disabled={pending} className="h-11 rounded-xl bg-pos-600 px-4 font-bold text-white hover:bg-pos-700 disabled:opacity-60">
                Check in
              </button>
              <button type="button" onClick={() => setChecking(false)} className="h-11 rounded-xl border border-pos-line px-4 font-semibold">
                Not now
              </button>
            </span>
          </form>
        ) : (
          <span className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setChecking(true)} className="h-10 rounded-xl bg-pos-600 px-4 font-bold text-white hover:bg-pos-700">
              Check in<span className="sr-only"> {transfer.number}</span>
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={async () => {
                if (!(await confirm({ title: `Take ${transfer.number} back?`, body: <p>Its {transfer.units} {transfer.units === 1 ? "unit goes" : "units go"} back to {transfer.from.name}&apos;s shelf.</p>, action: "Take it back" }))) return;
                start(async () => {
                  const result = await takeBackStock(transfer.id);
                  setState(result.ok ? { ok: true, message: `Back at ${transfer.from.name}.` } : { ok: false, message: result.message });
                  if (result.ok) router.refresh();
                });
              }}
              className="h-10 rounded-xl border border-pos-line bg-white px-4 font-semibold disabled:opacity-60"
            >
              Take back<span className="sr-only"> {transfer.number}</span>
            </button>
          </span>
        )
      ) : null}
      {state ? (
        <p role={state.ok ? "status" : "alert"} className={state.ok ? "font-semibold text-pos-700" : "font-semibold text-pos-error"}>
          {state.message}
        </p>
      ) : null}
      {dialog}
    </li>
  );
}
