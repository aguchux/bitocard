"use client";

import { useEffect, useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, ShieldCheck } from "lucide-react";
import { shopMoney } from "@bitocard/api-client/classifieds";
import { buyResale, quoteResale, type ResaleBuy, type ResaleQuote } from "@/lib/purchase-actions";

const nonce = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`.replace(/\./g, ""));
const field = "h-11 rounded-xl border border-slate-300 bg-white px-3 text-[15px]";

/**
 * Buying on a Resale shop: how many, in person or delivered (where and its charge), then the total from the store
 * wallet. Paying locks the money in the buyer's wallet until the supplier confirms; nothing goes to the store or the
 * supplier until the buyer has the item. Signed-out shoppers are asked to sign in first.
 */
export function ResaleBuy({ item, signedIn, signInHref, stateName }: { item: { ref: number; available: number; currency: string; price: number }; signedIn: boolean; signInHref: string; stateName: string | null }) {
  const id = useId();
  const router = useRouter();
  const [quantity, setQuantity] = useState(1);
  const [fulfilment, setFulfilment] = useState<"meet_up" | "delivery">("meet_up");
  const [zone, setZone] = useState<"state" | "elsewhere">("state");
  const [address, setAddress] = useState("");
  const [quote, setQuote] = useState<ResaleQuote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form] = useState(nonce);
  const [pending, start] = useTransition();

  const input = (): ResaleBuy => ({
    ref: item.ref,
    quantity,
    fulfilment,
    ...(fulfilment === "delivery" ? { delivery_address: address.trim().length >= 10 ? address : "To be confirmed at checkout", ...(zone === "state" && quote?.delivery?.state_id ? { delivery_state_id: quote.delivery.state_id } : {}) } : {}),
  });

  // The price for these choices, asked again whenever they change (the address only matters when buying).
  const key = `${quantity}:${fulfilment}:${zone}`;
  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    void quoteResale(input()).then(result => {
      if (!live) return;
      if (result.ok) {
        setQuote(result.data);
        setError(null);
        // A listing only delivered (or only handed over) starts on what it offers.
        if (!result.data.fulfilment.includes(fulfilment)) setFulfilment(result.data.fulfilment[0] ?? "meet_up");
        if (result.data.delivery && result.data.delivery.nationwide === null) setZone("state");
      } else setError(result.message);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-quoted when the choices change, not on every keystroke of the address
  }, [key, signedIn]);

  if (!signedIn) {
    return (
      <a href={signInHref} className="flex h-12 items-center justify-center rounded-2xl bg-navy-900 font-bold text-white hover:bg-navy-700">
        Sign in to buy
      </a>
    );
  }

  const buy = () =>
    start(async () => {
      if (!quote) return;
      if (fulfilment === "delivery" && address.trim().length < 10) {
        setError("Give the full delivery address.");
        return;
      }
      const result = await buyResale(input(), quote.total, form);
      if (result.ok) router.push(`/account/purchases/${result.data.id}`);
      else setError(result.message);
    });

  const charges = quote?.delivery;
  return (
    <form
      className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4"
      onSubmit={event => {
        event.preventDefault();
        buy();
      }}
    >
      <h2 className="font-bold">Buy it</h2>
      {item.available > 1 ? (
        <label className="grid gap-1.5 text-sm font-semibold" htmlFor={`${id}-qty`}>
          How many
          <select id={`${id}-qty`} value={quantity} onChange={event => setQuantity(Number(event.target.value))} className={field}>
            {Array.from({ length: Math.min(10, item.available) }, (_, index) => index + 1).map(value => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {quote && quote.fulfilment.length > 1 ? (
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-semibold">How you get it</legend>
          {quote.fulfilment.map(way => (
            <label key={way} className={`flex min-h-11 items-center gap-2.5 rounded-xl border px-3 text-sm ${fulfilment === way ? "border-navy-900 ring-1 ring-navy-900" : "border-slate-200"}`}>
              <input type="radio" name={`${id}-way`} checked={fulfilment === way} onChange={() => setFulfilment(way)} className="accent-navy-900" />
              {way === "meet_up" ? "Hand-over in person (you check it first)" : "Delivered with tracking"}
            </label>
          ))}
        </fieldset>
      ) : null}
      {fulfilment === "delivery" ? (
        <div className="grid gap-2">
          {charges ? (
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-semibold">Where it goes</legend>
              <label className={`flex min-h-11 items-center justify-between gap-2.5 rounded-xl border px-3 text-sm ${zone === "state" ? "border-navy-900 ring-1 ring-navy-900" : "border-slate-200"}`}>
                <span className="flex items-center gap-2.5">
                  <input type="radio" name={`${id}-zone`} checked={zone === "state"} onChange={() => setZone("state")} className="accent-navy-900" />
                  {stateName ? `In ${stateName}` : "In the supplier’s state"}
                </span>
                <span className="font-semibold">{charges.within_state ? shopMoney(charges.within_state, item.currency) : "Free"}</span>
              </label>
              {charges.nationwide !== null ? (
                <label className={`flex min-h-11 items-center justify-between gap-2.5 rounded-xl border px-3 text-sm ${zone === "elsewhere" ? "border-navy-900 ring-1 ring-navy-900" : "border-slate-200"}`}>
                  <span className="flex items-center gap-2.5">
                    <input type="radio" name={`${id}-zone`} checked={zone === "elsewhere"} onChange={() => setZone("elsewhere")} className="accent-navy-900" />
                    Elsewhere in the country
                  </span>
                  <span className="font-semibold">{charges.nationwide ? shopMoney(charges.nationwide, item.currency) : "Free"}</span>
                </label>
              ) : null}
            </fieldset>
          ) : null}
          <label className="grid gap-1.5 text-sm font-semibold" htmlFor={`${id}-address`}>
            Delivery address
            <textarea id={`${id}-address`} value={address} onChange={event => setAddress(event.target.value)} rows={3} maxLength={500} autoComplete="street-address" className="rounded-xl border border-slate-300 px-3 py-2 font-normal" />
          </label>
        </div>
      ) : null}
      {quote ? (
        <dl className="grid gap-1 text-sm">
          <div className="flex justify-between">
            <dt>{quote.quantity > 1 ? `Item × ${quote.quantity}` : "Item"}</dt>
            <dd className="font-semibold">{shopMoney(quote.price, quote.currency)}</dd>
          </div>
          {quote.delivery_fee ? (
            <div className="flex justify-between">
              <dt>Delivery</dt>
              <dd className="font-semibold">{shopMoney(quote.delivery_fee, quote.currency)}</dd>
            </div>
          ) : null}
          <div className="flex justify-between">
            <dt>Safe pay fee</dt>
            <dd className="font-semibold">{shopMoney(quote.buyer_fee, quote.currency)}</dd>
          </div>
          <div className="flex justify-between border-t border-slate-100 pt-2 text-base font-bold">
            <dt>Total from your wallet</dt>
            <dd>{shopMoney(quote.total, quote.currency)}</dd>
          </div>
          <div className="flex justify-between text-xs text-slate-500">
            <dt>Your wallet</dt>
            <dd>{shopMoney(quote.wallet_balance, quote.currency)}</dd>
          </div>
        </dl>
      ) : (
        <LoaderCircle className="size-5 animate-spin text-slate-400" aria-label="Working out the price" />
      )}
      {quote && !quote.phone_confirmed ? (
        <p className="rounded-xl bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
          Confirm your mobile number first: the supplier calls it to hand over or deliver.{" "}
          <a href="/account/profile/details" className="font-semibold underline">
            Add it
          </a>
        </p>
      ) : null}
      {quote && !quote.enough ? (
        <a href="/account/wallet?top_up=1" className="flex h-12 items-center justify-center rounded-2xl border border-slate-300 bg-white font-bold text-navy-900 hover:border-slate-400">
          Add {shopMoney(quote.total - quote.wallet_balance, quote.currency)} to your wallet
        </a>
      ) : null}
      <button type="submit" disabled={pending || !quote || !quote.enough || !quote.phone_confirmed} className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-emerald-700 font-bold text-white hover:bg-emerald-800 disabled:opacity-60">
        <ShieldCheck className="size-5" aria-hidden="true" />
        {quote ? `Pay ${shopMoney(quote.total, quote.currency)}` : "Pay"}
      </button>
      <p className="text-xs text-slate-600">Your money is locked in your wallet until the supplier confirms{quote ? ` (within ${quote.accept_hours} hours)` : ""}, then held by BitoCard until you have the item. If it is not confirmed, it goes straight back.</p>
      {error ? (
        <p role="alert" className="text-sm font-semibold text-brand-700">
          {error}
        </p>
      ) : null}
    </form>
  );
}
