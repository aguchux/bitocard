"use client";

import { useRef, useState, useTransition } from "react";
import { Ban, Plus, Smartphone, X } from "lucide-react";
import { formatFace, type StoreEsim, type StoreEsimTopUpOptions } from "@bitocard/api-client/storefront";
import { cancelEsim, type EsimSource, esimTopUpOptions, topUpEsim } from "@/lib/esim-actions";

const statusLabels: Record<StoreEsim["status"], string> = {
  ready: "Not installed yet",
  installed: "Installed",
  active: "In use",
  used_up: "Data used up",
  expired: "Expired",
  cancelled: "Cancelled and refunded",
  revoked: "Stopped by the network",
  suspended: "Suspended",
};

const size = (bytes: number) => (bytes >= 1024 ** 3 ? `${Number((bytes / 1024 ** 3).toFixed(1))}GB` : `${Math.round(bytes / 1024 ** 2)}MB`);
const date = (iso: string) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(new Date(iso));

/** Choosing and paying a top-up from the customer's wallet, in a native dialog. */
function TopUp({ source, esim, store }: { source: EsimSource; esim: StoreEsim; store: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [options, setOptions] = useState<StoreEsimTopUpOptions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [wallet, setWallet] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const open = () => {
    setError(null);
    setNotice(null);
    dialog.current?.showModal();
    start(async () => {
      const result = await esimTopUpOptions(source, esim.id);
      if (result.ok) setOptions(result.data);
      else setError(result.error);
    });
  };
  const selected = options?.data.find(item => item.id === chosen) ?? options?.data[0];
  const wallets = options?.wallets ?? [];
  // What the chosen top-up costs from a wallet (its own currency's price), and whether the wallet covers it.
  const costIn = (currency: string) => selected?.prices.find(price => price.currency === currency)?.amount ?? null;
  const covers = (item: { currency: string; balance: number }) => {
    const cost = costIn(item.currency);
    return cost !== null && item.balance >= cost;
  };
  const payFrom = wallets.find(item => item.currency === wallet) ?? wallets.find(covers) ?? wallets[0];
  const cost = payFrom ? costIn(payFrom.currency) : null;

  return (
    <>
      <button type="button" onClick={open} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#070f4c] px-4 text-sm font-semibold text-white hover:bg-[#0b1766]">
        <Plus className="size-4" aria-hidden="true" /> Top up
      </button>
      <dialog
        ref={dialog}
        aria-labelledby={`top-up-${esim.id}`}
        onClick={event => event.target === dialog.current && dialog.current?.close()}
        className="m-auto max-h-[90dvh] w-[min(32rem,calc(100vw-2rem))] overflow-y-auto rounded-3xl bg-white p-0 text-[#070f4c] shadow-2xl backdrop:bg-[#070f4c]/50"
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h2 id={`top-up-${esim.id}`} className="text-lg font-bold">
            Top up your eSIM
          </h2>
          <button type="button" aria-label="Close" onClick={() => dialog.current?.close()} className="grid size-11 place-items-center rounded-xl hover:bg-slate-50">
            <X className="size-6" aria-hidden="true" />
          </button>
        </div>
        <div className="space-y-4 p-5">
          {error ? <p className="rounded-2xl bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p> : null}
          {notice ? <p className="rounded-2xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-800" role="status">{notice}</p> : null}
          {!options ? (
            pending ? <p className="text-sm text-slate-600">Loading top-ups…</p> : null
          ) : !options.available ? (
            <p className="text-sm text-slate-600">Ask {store} to top this eSIM up for you.</p>
          ) : !options.data.length ? (
            <p className="text-sm text-slate-600">This eSIM takes no top-ups now.</p>
          ) : notice ? null : (
            <>
              <fieldset>
                <legend className="text-sm font-semibold">Add</legend>
                <div className="mt-2 grid gap-2">
                  {options.data.map(item => (
                    <label key={item.id} className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-slate-200 p-3 has-[:checked]:border-[#ff2382] has-[:checked]:bg-pink-50">
                      <span className="flex items-center gap-3">
                        <input type="radio" name={`option-${esim.id}`} checked={selected?.id === item.id} onChange={() => setChosen(item.id)} className="accent-[#ff2382]" />
                        <span className="text-sm font-semibold">{item.name}</span>
                      </span>
                      <span className="shrink-0 text-sm font-semibold">{formatFace(item.amount, item.currency)}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              {wallets.length > 1 ? (
                <fieldset>
                  <legend className="text-sm font-semibold">Pay from</legend>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {wallets.map(item => (
                      <label key={item.currency} className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3 has-[:checked]:border-[#ff2382] has-[:checked]:bg-pink-50">
                        <input type="radio" name={`wallet-${esim.id}`} checked={payFrom?.currency === item.currency} onChange={() => setWallet(item.currency)} className="mt-1 accent-[#ff2382]" />
                        <span>
                          <span className="block text-sm font-semibold">{item.currency === "USD" ? "US dollar wallet" : `${item.currency} wallet`}</span>
                          <span className="block text-sm">{costIn(item.currency) === null ? "Not available now" : formatFace(costIn(item.currency)!, item.currency)}</span>
                          <span className={`block text-xs ${covers(item) ? "text-slate-500" : "text-amber-700"}`}>Balance {formatFace(item.balance, item.currency)}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                  {payFrom && selected && payFrom.currency !== selected.currency ? <p className="mt-2 text-xs text-slate-500">Converted at our exchange rate. If it cannot be added, it goes back to this wallet in full.</p> : null}
                </fieldset>
              ) : null}
              <button
                type="button"
                disabled={pending || !selected || cost === null}
                onClick={() =>
                  start(async () => {
                    setError(null);
                    const result = await topUpEsim(source, esim.id, selected!.id, payFrom?.currency ?? "");
                    if (!result.ok) return setError(result.error);
                    setNotice(
                      result.data.status === "completed"
                        ? `${result.data.name} added.`
                        : result.data.status === "pending"
                          ? "Asked for: it is added as soon as the network confirms."
                          : (result.data.failure_reason ?? "It could not be added. Your money is back in your wallet."),
                    );
                  })
                }
                className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#ff2382] px-5 font-semibold text-white hover:bg-[#e8116d] disabled:opacity-60 sm:w-auto"
              >
                {pending ? "Paying…" : selected && payFrom && cost !== null ? `Pay ${formatFace(cost, payFrom.currency)} from your wallet` : "Top up"}
              </button>
            </>
          )}
        </div>
      </dialog>
    </>
  );
}

function Cancel({ source, esim, many }: { source: EsimSource; esim: StoreEsim; many: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (!window.confirm(many ? "Cancel every eSIM in this order for a full refund? They cannot be installed afterwards." : "Cancel this eSIM for a full refund? It cannot be installed afterwards.")) return;
          start(async () => {
            const result = await cancelEsim(source, esim.id);
            if (!result.ok) setError(result.error);
          });
        }}
        className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-slate-600 hover:bg-slate-50 hover:text-[#070f4c] disabled:opacity-60"
      >
        <Ban className="size-4" aria-hidden="true" /> {pending ? "Cancelling…" : "Cancel for a refund"}
      </button>
      {error ? <p className="mt-1 text-sm text-red-700" role="alert">{error}</p> : null}
    </div>
  );
}

/**
 * The order's eSIMs after delivery: each one's status, data use (as the network reports it, every few hours) and when
 * its plan ends; a top-up paid from the customer's wallet; and cancelling for a refund while none was installed.
 */
export function EsimManage({ source, esims, store }: { source: EsimSource; esims: StoreEsim[]; store: string }) {
  if (!esims.length) return null;
  return (
    <section aria-labelledby="esim-manage" className="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm sm:p-6">
      <h2 id="esim-manage" className="flex items-center gap-2 text-xl font-bold">
        <Smartphone className="size-5 text-[#ff2382]" aria-hidden="true" /> Data and top-ups
      </h2>
      <ul className="mt-4 grid gap-4">
        {esims.map((esim, index) => {
          const { total, used } = esim.data;
          const share = total && used !== null ? Math.min(used / total, 1) : null;
          return (
            <li key={esim.id} className="rounded-2xl border border-slate-200 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold">
                  {esims.length > 1 ? `eSIM ${index + 1}` : "Your eSIM"} <span className="font-mono text-xs font-normal text-slate-500">{esim.iccid}</span>
                </p>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">{statusLabels[esim.status]}</span>
              </div>
              {share !== null ? (
                <div className="mt-3">
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-label="Data used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)}>
                    <div className={`h-full rounded-full ${share > 0.9 ? "bg-amber-500" : "bg-[#ff2382]"}`} style={{ width: `${share * 100}%` }} />
                  </div>
                  <p className="mt-1 text-sm text-slate-600">
                    {size(Math.max(total! - used!, 0))} left of {size(total!)}
                    {esim.data.updated_at ? ` · updated ${date(esim.data.updated_at)}` : ""}
                  </p>
                </div>
              ) : null}
              {esim.expires_at ? <p className="mt-2 text-sm text-slate-600">{esim.status === "ready" ? `Install by ${date(esim.expires_at)}` : `Plan ends ${date(esim.expires_at)}`}</p> : null}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {esim.top_ups !== "none" && ["ready", "installed", "active", "used_up"].includes(esim.status) ? <TopUp source={source} esim={esim} store={store} /> : null}
                {esim.cancellable ? <Cancel source={source} esim={esim} many={esims.length > 1} /> : null}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-4 text-xs text-slate-500">Data use is reported by the network every few hours. An eSIM that was installed cannot be refunded.</p>
    </section>
  );
}
