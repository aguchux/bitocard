"use client";

import { createContext, type InputHTMLAttributes, type ReactNode, useActionState, useContext, useId, useRef } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Check, CheckCircle2, LoaderCircle, Plus } from "lucide-react";

/** What a form's server action answers: an error (naming the field the API named), or a notice. */
export type FormState = { error?: string; field?: string | null; notice?: string };
/** A form that moves money also carries a fresh nonce after each answer (its Idempotency-Key). */
export type NonceFormState = FormState & { nonce?: string };

type Action<S> = (state: S, form: FormData) => Promise<S>;

/**
 * The trading actions of the app the forms are in (its own server actions, over its own session): the storefront's
 * Crypto tab and BitoCard Crypto each give theirs, so the same forms serve both.
 */
export type TradeActions = {
  takeAd: Action<FormState>;
  confirmTrade: Action<NonceFormState>;
  postAd: Action<FormState>;
  repriceAd: Action<FormState>;
  chooseNickname: Action<FormState>;
};

/** Where the forms send people in that app: posting an ad (with `?side&asset&market`), and topping up the wallet. */
export type TradeLinks = { postAd: string; wallet: string };

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

/** Taking an ad: the amount, then the confirmation page, where the customer sees exactly what they get. */
export function TakeAdForm({ adId, price, currency, side, min, max }: { adId: string; price: number; currency: string; side: "buy" | "sell"; min: string; max: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(useTrade().actions.takeAd, {});
  return (
    <form action={action} className="flex flex-col gap-2 sm:flex-row sm:items-end" aria-label={side === "buy" ? "Buy from this ad" : "Sell to this ad"}>
      <input type="hidden" name="ad_id" value={adId} />
      <input type="hidden" name="price" value={price} />
      <div className="min-w-0 flex-1">
        <Field label={`Amount (${currency})`} name="fiat" inputMode="decimal" placeholder={`${min} – ${max}`} required state={state} />
      </div>
      <Submit pending={pending} className={side === "buy" ? "bg-emerald-600 hover:bg-emerald-700" : ""}>
        {side === "buy" ? "Buy" : "Sell"}
      </Submit>
      {state.error ? (
        <p className="text-sm text-red-700" role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

/** The final step: confirms exactly the trade shown. */
export function ConfirmTradeForm({ adId, price, feeBps, fiat, label, nonce }: { adId: string; price: number; feeBps: number; fiat: number; label: string; nonce: string }) {
  const { actions, links } = useTrade();
  const [state, action, pending] = useActionState<NonceFormState, FormData>(actions.confirmTrade, {});
  return (
    <form action={action} className="space-y-3">
      {/* Sent as the Idempotency-Key, so a double tap trades once. */}
      <input type="hidden" name="nonce" value={state.nonce ?? nonce} />
      <input type="hidden" name="ad_id" value={adId} />
      <input type="hidden" name="price" value={price} />
      <input type="hidden" name="fee_bps" value={feeBps} />
      <input type="hidden" name="fiat" value={fiat} />
      <FormMessage state={state} />
      {state.field === "funds" ? (
        <a href={links.wallet} className="inline-flex min-h-11 items-center font-semibold text-brand-500 hover:underline">
          Add money to your wallet
        </a>
      ) : null}
      <Submit pending={pending} className="w-full">
        <Check className="size-4" aria-hidden="true" /> {label}
      </Submit>
    </form>
  );
}

/** Posting an ad: sell (your crypto is locked for the market) or buy (the money it needs is locked). */
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
          hint={side === "sell" ? "Locked from your coin wallet while the ad is open." : `Calculated from your ${currency} balance at the suggested price; the final amount is locked when you post.`}
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

/** Market cards show one action; the amount is asked only for the ad chosen. */
export function TakeAdDialog(props: { adId: string; price: number; currency: string; side: "buy" | "sell"; min: string; max: string; asset: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button type="button" className={button} onClick={() => dialog.current?.showModal()}>
        {props.side === "buy" ? "Buy" : "Sell"} {props.asset}
      </button>
      <dialog ref={dialog} className={dialogClass} aria-labelledby={`take-${props.adId}`}>
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 id={`take-${props.adId}`} className="font-display text-xl font-extrabold">
              {props.side === "buy" ? "Buy" : "Sell"} {props.asset}
            </h2>
            <p className="mt-1 text-sm text-slate-600">Enter an amount to review the trade.</p>
          </div>
          <button type="button" className="min-h-10 px-2 text-sm font-semibold text-slate-600" onClick={() => dialog.current?.close()}>
            Close
          </button>
        </div>
        <TakeAdForm {...props} />
      </dialog>
    </>
  );
}
