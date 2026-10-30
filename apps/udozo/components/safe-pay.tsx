"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { shopMoney, type ShopSafePayQuote } from "@bitocard/api-client/classifieds";
import { TermsAccept, termsCode } from "@/components/terms-accept";
import { acceptShopTerms, cancelSafePay, paySafePay, requestSafePay, shopTerms } from "@/lib/listing-actions";

const nonce = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`.replace(/\./g, ""));

/**
 * The buyer's request: meet-up or delivery (where it goes, with its delivery charge, and the address), then sent to the
 * seller, who has the accept time to answer.
 */
export function SafePayRequest({ quote, sellerName, acceptHours, stateName }: { quote: ShopSafePayQuote; sellerName: string; acceptHours: number | null; stateName?: string | null }) {
  const router = useRouter();
  const [fulfilment, setFulfilment] = useState<"meet_up" | "delivery">(quote.fulfilment[0] ?? "meet_up");
  const [address, setAddress] = useState("");
  const charges = quote.delivery;
  const [zone, setZone] = useState<"state" | "elsewhere">("state");
  const charge = !charges ? 0 : zone === "elsewhere" && charges.nationwide !== null ? charges.nationwide : charges.within_state;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(nonce);
  const [needsTerms, setNeedsTerms] = useState(false);

  const send = async (attempt: string) => {
    setBusy(true);
    setError(null);
    const result = await requestSafePay({ listingId: quote.listing_id, offerId: quote.offer_id, fulfilment, address, stateId: fulfilment === "delivery" && zone === "state" ? (charges?.state_id ?? undefined) : undefined, nonce: attempt });
    if (result.ok) return router.refresh();
    setBusy(false);
    // Safe pay needs the Udozo terms accepted: ask, then send again (a refused request is final, so a new key).
    if (result.code === termsCode) return setNeedsTerms(true);
    setError(result.message);
  };
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    void send(key);
  };
  const afterTerms = () => {
    setNeedsTerms(false);
    const next = nonce();
    setKey(next);
    void send(next);
  };

  return (
    <form onSubmit={submit} className="grid gap-4">
      <fieldset className="grid gap-2.5">
        <legend className="mb-1 text-base font-bold">How will you get it?</legend>
        {quote.fulfilment.includes("meet_up") ? (
          <label className="flex gap-3 rounded-2xl border border-navy-200 bg-white p-3.5 has-checked:border-2 has-checked:border-navy-900">
            <input type="radio" name="fulfilment" value="meet_up" checked={fulfilment === "meet_up"} onChange={() => setFulfilment("meet_up")} className="mt-1 size-4 accent-navy-900" />
            <span className="grid gap-0.5">
              <strong>Meet in person</strong>
              <span className="text-sm text-navy-600">Inspect it, then give the seller your 6-digit release code.</span>
            </span>
          </label>
        ) : null}
        {quote.fulfilment.includes("delivery") ? (
          <label className="flex gap-3 rounded-2xl border border-navy-200 bg-white p-3.5 has-checked:border-2 has-checked:border-navy-900">
            <input type="radio" name="fulfilment" value="delivery" checked={fulfilment === "delivery"} onChange={() => setFulfilment("delivery")} className="mt-1 size-4 accent-navy-900" />
            <span className="grid gap-0.5">
              <strong>Delivery with tracking</strong>
              <span className="text-sm text-navy-600">The seller ships it with a courier; confirm when it arrives in good condition.</span>
            </span>
          </label>
        ) : null}
      </fieldset>
      {fulfilment === "delivery" && charges ? (
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-semibold">Where it goes</legend>
          <label className="flex items-center justify-between gap-3 rounded-xl border border-navy-200 bg-white px-3 py-2.5 text-sm has-checked:border-2 has-checked:border-navy-900">
            <span className="flex items-center gap-2.5">
              <input type="radio" name="zone" checked={zone === "state"} onChange={() => setZone("state")} className="size-4 accent-navy-900" />
              {stateName ? `In ${stateName}` : "In the seller’s state"}
            </span>
            <strong>{charges.within_state ? shopMoney(charges.within_state, quote.currency) : "Free"}</strong>
          </label>
          {charges.nationwide !== null ? (
            <label className="flex items-center justify-between gap-3 rounded-xl border border-navy-200 bg-white px-3 py-2.5 text-sm has-checked:border-2 has-checked:border-navy-900">
              <span className="flex items-center gap-2.5">
                <input type="radio" name="zone" checked={zone === "elsewhere"} onChange={() => setZone("elsewhere")} className="size-4 accent-navy-900" />
                Elsewhere in the country
              </span>
              <strong>{charges.nationwide ? shopMoney(charges.nationwide, quote.currency) : "Free"}</strong>
            </label>
          ) : null}
          {charge ? <span className="text-xs text-navy-600">The delivery charge is added to the total and goes to the seller once you have it; it is refunded if it never arrives.</span> : null}
        </fieldset>
      ) : null}
      {fulfilment === "delivery" ? (
        <label className="grid gap-1.5 text-sm font-semibold">
          Delivery address
          <textarea value={address} onChange={event => setAddress(event.target.value)} rows={3} minLength={10} maxLength={500} required placeholder="House number, street, area, city" className="rounded-xl border border-navy-200 px-3 py-2.5 text-[15px] font-normal focus:border-navy-500" />
          <span className="text-xs font-normal text-navy-600">Only the seller sees it, once you have paid.</span>
        </label>
      ) : null}
      {error ? (
        <p className="text-sm font-semibold text-brand-700" role="alert">
          {error}
        </p>
      ) : null}
      {needsTerms ? <TermsAccept load={shopTerms} accept={acceptShopTerms} onAccepted={afterTerms} /> : null}
      <button type="submit" disabled={busy || needsTerms} className="flex h-13 items-center justify-center gap-2 rounded-2xl bg-mint-700 font-bold text-white hover:bg-mint-500 disabled:opacity-60">
        <ShieldCheck className="size-5" aria-hidden="true" /> {busy ? "Sending…" : "Send request to seller"}
      </button>
      <p className="text-center text-sm text-navy-600">
        You pay only after {sellerName} accepts{acceptHours ? `, within ${acceptHours} hours` : ""}.
      </p>
    </form>
  );
}

/** Paying an accepted order from the wallet, or cancelling it; a balance too low says how much to add. */
export function SafePayOrderActions({ orderId, canPay, canCancel, addFundsHref, total, currency }: { orderId: string; canPay: boolean; canCancel: boolean; addFundsHref: string | null; total: number; currency: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [low, setLow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [key] = useState(nonce);

  const pay = async () => {
    setBusy(true);
    setError(null);
    const result = await paySafePay(orderId, key);
    if (result.ok) router.refresh();
    else {
      setLow(result.code === "wallet_balance_low");
      setError(result.message);
    }
    setBusy(false);
  };
  const cancel = async () => {
    if (!window.confirm("Cancel this Safe pay request?")) return;
    setBusy(true);
    const result = await cancelSafePay(orderId);
    if (result.ok) router.refresh();
    else setError(result.message);
    setBusy(false);
  };

  return (
    <div className="grid gap-3">
      {canPay ? (
        <button type="button" onClick={() => void pay()} disabled={busy} className="flex h-13 items-center justify-center gap-2 rounded-2xl bg-mint-700 font-bold text-white hover:bg-mint-500 disabled:opacity-60">
          <ShieldCheck className="size-5" aria-hidden="true" /> {busy ? "Paying…" : `Pay ${shopMoney(total, currency)} from my wallet`}
        </button>
      ) : null}
      {error ? (
        <p className="text-sm font-semibold text-brand-700" role="alert">
          {error}{" "}
          {low && addFundsHref ? (
            <a href={addFundsHref} className="underline">
              Add funds
            </a>
          ) : null}
        </p>
      ) : null}
      {canCancel ? (
        <button type="button" onClick={() => void cancel()} disabled={busy} className="h-11 rounded-2xl border border-navy-200 font-semibold text-navy-700 hover:border-navy-500 disabled:opacity-60">
          Cancel request
        </button>
      ) : null}
    </div>
  );
}
