"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { useConfirm } from "@/components/confirm-dialog";
import type { PosShop } from "@/lib/pos";
import { addShop, chooseShop } from "@/lib/pos-actions";

const quiet = "inline-flex h-10 items-center justify-center rounded-xl border border-pos-line bg-white px-3 text-sm font-semibold text-pos-ink hover:bg-pos-50 disabled:opacity-50";
const badge = "rounded-full px-2.5 py-0.5 text-xs font-semibold";

/**
 * The owner's shops (milestone 8): which is main (a plan of one shop keeps it selling), which fulfils online orders once
 * the online stock is used up, which are paused past the plan's shop limit, and opening another within it. From the
 * second shop, each listing's stock is split between them.
 */
export function ShopsPanel({ shops, limit, planName }: { shops: PosShop[]; limit: number | null; planName: string }) {
  const router = useRouter();
  const ids = useId();
  const [confirm, dialog] = useConfirm();
  const [name, setName] = useState("");
  const [state, setState] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, start] = useTransition();
  const room = limit === null || shops.length < limit;
  const run = (work: () => Promise<{ ok: boolean; message?: string }>, done: string) =>
    start(async () => {
      const result = await work();
      setState(result.ok ? { ok: true, message: done } : { ok: false, message: result.message ?? "That did not work." });
      if (result.ok) router.refresh();
    });
  return (
    <div className="grid gap-4">
      {shops.length > 1 ? <p className="text-pos-ink-2">Each product&apos;s stock is split between your shops. Move stock between them from Products.</p> : null}
      <ul className="grid gap-2">
        {shops.map(shop => (
          <li key={shop.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-pos-line p-3">
            <span className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="font-semibold text-pos-ink">{shop.name}</span>
              <span className="text-sm text-pos-muted">{shop.shop_code}</span>
              {shop.main ? <span className={`${badge} bg-pos-50 text-pos-700`}>Main shop</span> : null}
              {shops.length > 1 && shop.fulfils_online ? <span className={`${badge} bg-pos-50 text-pos-700`}>Fulfils online orders</span> : null}
              {shop.paused ? <span className={`${badge} bg-pos-warn-bg text-pos-warn`}>Paused on {planName}</span> : null}
            </span>
            {shops.length > 1 ? (
              <span className="flex flex-wrap gap-2">
                {!shop.main ? (
                  <button
                    type="button"
                    className={quiet}
                    disabled={pending}
                    onClick={async () => {
                      if (!(await confirm({ title: `Make ${shop.name} your main shop?`, body: <p>It comes first, and is the shop that keeps selling on a plan of one shop.</p>, action: "Make it main" }))) return;
                      run(() => chooseShop(shop.id, "main"), `${shop.name} is your main shop.`);
                    }}
                  >
                    Make main<span className="sr-only"> shop: {shop.name}</span>
                  </button>
                ) : null}
                {!shop.fulfils_online ? (
                  <button
                    type="button"
                    className={quiet}
                    disabled={pending}
                    onClick={async () => {
                      if (!(await confirm({ title: `Fulfil online orders from ${shop.name}?`, body: <p>Orders on udozo.com take stock that is in no shop first, then from {shop.name}.</p>, action: "Fulfil from here" }))) return;
                      run(() => chooseShop(shop.id, "fulfils_online"), `Online orders now take from ${shop.name}.`);
                    }}
                  >
                    Fulfil online orders<span className="sr-only"> from {shop.name}</span>
                  </button>
                ) : null}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      {room ? (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={async event => {
            event.preventDefault();
            if (!name.trim()) return setState({ ok: false, message: "Give the shop's name." });
            if (shops.length === 1 && !(await confirm({ title: `Open ${name.trim()}?`, body: <p>From your second shop, each product&apos;s stock is split between shops. Everything you have now stays in {shops[0]!.name}; move stock to {name.trim()} from Products.</p>, action: "Open the shop" }))) return;
            run(async () => {
              const result = await addShop(name);
              if (result.ok) setName("");
              return result;
            }, `${name.trim()} is open. Add its tills below.`);
          }}
        >
          <div className="min-w-0 flex-1">
            <label htmlFor={`${ids}-name`} className="block text-sm font-semibold text-pos-ink-2">
              Another shop
            </label>
            <input id={`${ids}-name`} value={name} onChange={event => setName(event.target.value)} maxLength={80} placeholder="Lekki shop" className="mt-1 h-12 w-full rounded-xl border border-pos-line bg-white px-3 text-pos-ink focus:border-pos-600 focus:ring-2 focus:ring-pos-50 focus:outline-none" />
          </div>
          <button type="submit" disabled={pending} className="flex h-12 items-center rounded-xl bg-pos-600 px-6 font-bold text-white hover:bg-pos-700 disabled:opacity-60">
            Open a shop
          </button>
        </form>
      ) : (
        <p className="text-sm text-pos-ink-2">
          {planName} has {limit === 1 ? "one shop" : `${limit} shops`}.{" "}
          <a href="/app/billing" className="font-semibold">
            Multi-shop
          </a>{" "}
          opens more, with stock split between them.
        </p>
      )}
      {state ? (
        <p role={state.ok ? "status" : "alert"} className={state.ok ? "font-semibold text-pos-700" : "font-semibold text-pos-error"}>
          {state.message}
        </p>
      ) : null}
      {dialog}
    </div>
  );
}
