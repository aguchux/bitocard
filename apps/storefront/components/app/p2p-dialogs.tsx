"use client";

import { useRef } from "react";
import { useRouter } from "next/navigation";
import { TakeAdForm } from "./crypto-forms";

const button = "inline-flex min-h-11 items-center justify-center rounded-xl bg-brand-500 px-4 font-semibold text-white hover:bg-brand-600";

/** Collect only the intent here. The dedicated route holds the money-moving form. */
export function PostAdLauncher({
  assets,
  initialAsset = "USDT",
  initialSide = "buy",
  initialMarket = "",
  label = "Post ad",
}: {
  assets: string[];
  initialAsset?: string;
  initialSide?: "buy" | "sell";
  /** The market the ad is posted in ("" for the customer's own). */
  initialMarket?: string;
  label?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  return (
    <>
      <button type="button" className={button} onClick={() => dialog.current?.showModal()}>{label}</button>
      <dialog ref={dialog} className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-3xl border border-slate-200 bg-white p-6 text-navy-900 shadow-2xl backdrop:bg-navy-900/50" aria-labelledby="post-ad-title">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="post-ad-title" className="font-display text-xl font-extrabold">Post an ad</h2>
            <p className="mt-1 text-sm text-slate-600">Choose what you want to trade.</p>
          </div>
          <button type="button" className="min-h-10 px-2 text-sm font-semibold text-slate-600" onClick={() => dialog.current?.close()} aria-label="Close dialog">Close</button>
        </div>
        <form className="mt-5 space-y-4" onSubmit={event => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const side = data.get("side") === "sell" ? "sell" : "buy";
          const asset = String(data.get("asset") ?? "USDT");
          dialog.current?.close();
          router.push(`/account/crypto/ads/post?${new URLSearchParams({ side, asset, ...(initialMarket ? { market: initialMarket } : {}) })}`);
        }}>
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold">I want to</legend>
            <div className="grid grid-cols-2 gap-2">
              {(["buy", "sell"] as const).map(side => <label key={side} className="flex min-h-12 cursor-pointer items-center justify-center rounded-xl border border-slate-200 text-sm font-semibold has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50 has-[:checked]:text-brand-700"><input className="sr-only" type="radio" name="side" value={side} defaultChecked={side === initialSide} />{side === "buy" ? "I want to buy" : "I want to sell"}</label>)}
            </div>
          </fieldset>
          <label className="block text-sm font-semibold">Coin
            <select name="asset" defaultValue={assets.includes(initialAsset) ? initialAsset : assets[0]} className="mt-2 min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3">
              {assets.map(asset => <option key={asset} value={asset}>{asset}</option>)}
            </select>
          </label>
          <button type="submit" className={`${button} w-full`}>Continue</button>
        </form>
      </dialog>
    </>
  );
}

/** Market cards show one action; amount entry opens only for the selected ad. */
export function TakeAdDialog(props: { adId: string; price: number; currency: string; side: "buy" | "sell"; min: string; max: string; asset: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  return <>
    <button type="button" className={button} onClick={() => dialog.current?.showModal()}>{props.side === "buy" ? "Buy" : "Sell"} {props.asset}</button>
    <dialog ref={dialog} className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-3xl border border-slate-200 bg-white p-6 text-navy-900 shadow-2xl backdrop:bg-navy-900/50" aria-labelledby={`take-${props.adId}`}>
      <div className="mb-5 flex items-start justify-between gap-4"><div><h2 id={`take-${props.adId}`} className="font-display text-xl font-extrabold">{props.side === "buy" ? "Buy" : "Sell"} {props.asset}</h2><p className="mt-1 text-sm text-slate-600">Enter an amount to review the trade.</p></div><button type="button" className="min-h-10 px-2 text-sm font-semibold text-slate-600" onClick={() => dialog.current?.close()}>Close</button></div>
      <TakeAdForm {...props} />
    </dialog>
  </>;
}
