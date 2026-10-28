"use client";

import { createContext, type InputHTMLAttributes, type ReactNode, useActionState, useContext, useId, useRef } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, LoaderCircle, Plus } from "lucide-react";

/** What a form's server action answers: an error (naming the field the API named), or a notice. */
export type FormState = { error?: string; field?: string | null; notice?: string };
/** A form that moves money also carries a fresh nonce after each answer (its Idempotency-Key). */
export type NonceFormState = FormState & { nonce?: string };

type Action<S> = (state: S, form: FormData) => Promise<S>;

/**
 * The trading actions of the app the forms are in (its own server actions, over its own session): the storefront's
 * Afrippa's site gives its own.
 */
export type TradeActions = {
  postAd: Action<FormState>;
  repriceAd: Action<FormState>;
  /** Pauses, resumes or closes an ad (`op`: pause, resume, cancel). */
  changeAd: Action<FormState>;
  chooseNickname: Action<FormState>;
};

/** Where the forms send people in that app: posting an ad (with `?side&asset&market`). */
export type TradeLinks = { postAd: string };

const Context = createContext<{ actions: TradeActions; links: TradeLinks } | null>(null);

/** Gives the trading forms below the app's actions and links (in a server layout, passing its server actions). */
export function CryptoActionsProvider({ actions, links, children }: { actions: TradeActions; links: TradeLinks; children?: ReactNode }) {
  return <Context.Provider value={{ actions, links }}>{children}</Context.Provider>;
}

function useTrade() {
  const value = useContext(Context);
  if (!value) throw new Error("Trading forms need a CryptoActionsProvider");
  return value;
}

const inputClass = "min-h-12 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-[15px] text-navy-900 focus:border-navy-900 focus:ring-2 focus:ring-navy-900/15 aria-[invalid=true]:border-red-400";
const button = "inline-flex min-h-11 items-center justify-center rounded-xl bg-brand-500 px-4 font-semibold text-white hover:bg-brand-600";

/** The action's error or notice, read out. */
export function FormMessage({ state }: { state: FormState }) {
  if (state.error) {
    return (
      <p role="alert" className="flex items-start gap-2 rounded-xl bg-red-50 px-3.5 py-3 text-sm text-red-800">
        <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        {state.error}
      </p>
    );
  }
  if (state.notice) {
    return (
      <p role="status" className="flex items-start gap-2 rounded-xl bg-emerald-50 px-3.5 py-3 text-sm text-emerald-800">
        <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        {state.notice}
      </p>
    );
  }
  return null;
}

/** A labelled input, outlined when the API named it in its error. */
export function Field({ label, name, state, hint, ...props }: { label: string; name: string; state?: FormState; hint?: ReactNode } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-semibold text-navy-900">
        {label}
      </label>
      <input id={id} name={name} className={inputClass} aria-invalid={state?.field === name || undefined} aria-describedby={hint ? `${id}-hint` : undefined} {...props} />
      {hint ? (
        <p id={`${id}-hint`} className="text-xs text-slate-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function Submit({ pending, children, className = "" }: { pending: boolean; children: ReactNode; className?: string }) {
  return (
    <button type="submit" disabled={pending} className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-brand-500 px-5 font-semibold text-white hover:bg-brand-600 disabled:opacity-60 ${className}`}>
      {pending ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

/** Posting an ad: sell (your crypto is locked for the market) or buy (nothing is locked: the seller's coins go to escrow when an order opens). */
export function PostAdForm({
  asset,
  currency,
  side,
  market = "",
  suggestedPrice,
  suggestedAmount,
  suggestedMax,
}: {
  asset: string;
  currency: string;
  side: "buy" | "sell";
  /** The market the ad goes in ("" for the customer's own). */
  market?: string;
  suggestedPrice?: string;
  suggestedAmount?: string;
  suggestedMax?: string;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(useTrade().actions.postAd, {});
  return (
    <form action={action} className="space-y-4" aria-label="Post an ad">
      <input type="hidden" name="side" value={side} />
      <input type="hidden" name="asset" value={asset} />
      <input type="hidden" name="currency" value={currency} />
      {market ? <input type="hidden" name="market" value={market} /> : null}
      <FormMessage state={state} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label={`Your price per ${asset} (${currency})`}
          name="price"
          inputMode="decimal"
          defaultValue={suggestedPrice}
          placeholder="Enter a price"
          required
          state={state}
          hint={suggestedPrice ? "Filled from the current market price and desk markup. You can edit it." : "Enter the price you want to offer."}
        />
        <Field
          label={`How much (${asset})`}
          name="amount"
          inputMode="decimal"
          defaultValue={suggestedAmount}
          placeholder="Amount"
          required
          state={state}
          hint={side === "sell" ? "Locked from your coin wallet while the ad is open." : "How much you want to buy. Nothing is locked: the seller's coins are held when an order opens."}
        />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Min per trade" name="min_fiat" inputMode="decimal" placeholder="Minimum" required state={state} />
          <Field label="Max per trade" name="max_fiat" inputMode="decimal" defaultValue={suggestedMax} placeholder="Maximum" required state={state} />
        </div>
      </div>
      <Field label="Terms (optional)" name="terms" maxLength={500} placeholder="Anything buyers should know" state={state} />
      <Submit pending={pending} className="w-full sm:w-auto">
        <Plus className="size-4" aria-hidden="true" /> Post ad
      </Submit>
    </form>
  );
}

export function RepriceForm({ id, currency, price }: { id: string; currency: string; price: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(useTrade().actions.repriceAd, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-2" aria-label="Change price">
      <input type="hidden" name="id" value={id} />
      <div className="w-40">
        <Field label={`New price (${currency})`} name="price" inputMode="decimal" defaultValue={price} required state={state} />
      </div>
      <button type="submit" disabled={pending} className="min-h-12 rounded-xl px-4 font-semibold ring-1 ring-slate-300 hover:ring-slate-400 disabled:opacity-60">
        Save
      </button>
      {state.error || state.notice ? <p className={`basis-full text-sm ${state.error ? "text-red-700" : "text-emerald-700"}`}>{state.error ?? state.notice}</p> : null}
    </form>
  );
}

/** One button changing an ad (pause, resume or close), with its error under it. */
function AdButton({ id, op, children, danger = false }: { id: string; op: "pause" | "resume" | "cancel"; children: string; danger?: boolean }) {
  const [state, run, pending] = useActionState<FormState, FormData>(useTrade().actions.changeAd, {});
  return (
    <form action={run} className="inline-flex flex-col items-start gap-1">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="op" value={op} />
      <button type="submit" disabled={pending} className={`min-h-12 rounded-xl px-4 text-sm font-semibold ring-1 disabled:opacity-60 ${danger ? "text-red-700 ring-red-200 hover:ring-red-300" : "ring-slate-300 hover:ring-slate-400"}`}>
        {children}
      </button>
      {state.error ? (
        <p className="max-w-xs text-sm text-red-700" role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

/** An open ad's controls: a new price, pause or resume, and close (which gives back what it locks). */
export function AdControls({ id, status, currency, price }: { id: string; status: "active" | "paused" | "completed" | "cancelled"; currency: string; price: number }) {
  return (
    <>
      <RepriceForm id={id} currency={currency} price={String(price / 100)} />
      <AdButton id={id} op={status === "active" ? "pause" : "resume"}>
        {status === "active" ? "Pause" : "Resume"}
      </AdButton>
      <AdButton id={id} op="cancel" danger>
        Close ad
      </AdButton>
    </>
  );
}

export function NicknameForm({ current }: { current: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(useTrade().actions.chooseNickname, {});
  return (
    <form action={action} className="space-y-3" aria-label="Choose your nickname">
      <FormMessage state={state} />
      <Field
        label="Nickname"
        name="nickname"
        defaultValue={current}
        pattern="[A-Za-z0-9_]{3,20}"
        maxLength={20}
        required
        state={state}
        hint="What other traders see instead of your name. 3 to 20 letters, numbers or underscores; you can choose it once."
      />
      <Submit pending={pending}>Save nickname</Submit>
    </form>
  );
}

const dialogClass = "m-auto w-[min(28rem,calc(100vw-2rem))] rounded-3xl border border-slate-200 bg-white p-6 text-navy-900 shadow-2xl backdrop:bg-navy-900/50";

/** Posting starts with the intent here; the app's post page holds the money-moving form. */
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
  const { links } = useTrade();
  return (
    <>
      <button type="button" className={button} onClick={() => dialog.current?.showModal()}>
        {label}
      </button>
      <dialog ref={dialog} className={dialogClass} aria-labelledby="post-ad-title">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="post-ad-title" className="font-display text-xl font-extrabold">
              Post an ad
            </h2>
            <p className="mt-1 text-sm text-slate-600">Choose what you want to trade.</p>
          </div>
          <button type="button" className="min-h-10 px-2 text-sm font-semibold text-slate-600" onClick={() => dialog.current?.close()} aria-label="Close dialog">
            Close
          </button>
        </div>
        <form
          className="mt-5 space-y-4"
          onSubmit={event => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const side = data.get("side") === "sell" ? "sell" : "buy";
            const asset = String(data.get("asset") ?? "USDT");
            dialog.current?.close();
            router.push(`${links.postAd}?${new URLSearchParams({ side, asset, ...(initialMarket ? { market: initialMarket } : {}) })}`);
          }}
        >
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold">I want to</legend>
            <div className="grid grid-cols-2 gap-2">
              {(["buy", "sell"] as const).map(side => (
                <label
                  key={side}
                  className="flex min-h-12 cursor-pointer items-center justify-center rounded-xl border border-slate-200 text-sm font-semibold has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50 has-[:checked]:text-brand-700"
                >
                  <input className="sr-only" type="radio" name="side" value={side} defaultChecked={side === initialSide} />
                  {side === "buy" ? "I want to buy" : "I want to sell"}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="block text-sm font-semibold">
            Coin
            <select name="asset" defaultValue={assets.includes(initialAsset) ? initialAsset : assets[0]} className="mt-2 min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3">
              {assets.map(asset => (
                <option key={asset} value={asset}>
                  {asset}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className={`${button} w-full`}>
            Continue
          </button>
        </form>
      </dialog>
    </>
  );
}
