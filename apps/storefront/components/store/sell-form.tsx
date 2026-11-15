"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useMemo, useState, useTransition } from "react";
import { Camera, KeyRound, LoaderCircle, ShieldCheck, X } from "lucide-react";
import type { GiftCardSellOffer } from "@bitocard/api-client/storefront";
import { compressImage } from "@bitocard/ui/image";
import { money } from "@/lib/money";
import { quoteSale } from "@/lib/sell-actions";

const maxPhotos = 20;

const optionClass =
  "flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 font-semibold text-navy-900 has-[:checked]:border-brand-500 has-[:checked]:bg-pink-50 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-500/40";

/** What the customer gets for `amount`, worked out as the store does (rate per unit after the margin). */
export const estimate = (offer: GiftCardSellOffer, amount: number) => Math.max(0, Math.floor(offer.rate * amount));

/**
 * Selling a gift card on its page: which card it is (when there are several kinds), photos of a physical card or the
 * code of an e-code, its value, then the exact amount the customer gets, then Sell. Nothing is paid until the card is
 * accepted; the customer follows it under Orders > Sold gift cards.
 */
export function SellForm({ offers, signedIn, back, sandbox = false }: { offers: GiftCardSellOffer[]; signedIn: boolean; back: string; sandbox?: boolean }) {
  const id = useId();
  const router = useRouter();
  const [offerId, setOfferId] = useState(offers[0]?.id ?? "");
  const offer = offers.find(item => item.id === offerId) ?? offers[0];
  const [how, setHow] = useState<"photos" | "code">(offer?.form === "ecode" ? "code" : "photos");
  const [amount, setAmount] = useState("");
  const [code, setCode] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [quote, setQuote] = useState<{ payout: number; currency: string; amount: number; offerId: string } | null>(null);
  const [error, setError] = useState<{ message: string; code: string | null } | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [quoting, startQuote] = useTransition();
  const [sending, setSending] = useState(false);
  const [key] = useState(() => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now())));

  const value = Number(amount);
  const valid = Boolean(offer) && Number.isInteger(value) && value >= (offer?.minimum ?? 1) && value <= (offer?.maximum ?? 10_000);
  const about = useMemo(() => (offer && valid ? estimate(offer, value) : 0), [offer, valid, value]);
  const ready = valid && (how === "code" ? code.trim().length >= 4 : photos.length > 0);
  const current = quote && quote.amount === value && quote.offerId === offer?.id ? quote : null;

  if (!offer) return null;
  if (!signedIn) {
    return (
      <div className="mt-6 rounded-2xl bg-slate-50 p-5">
        <p className="font-semibold text-navy-900">Get up to {money(offer.rate, offer.currency)} for every 1 of the card’s value.</p>
        <Link href={`/signin?next=${encodeURIComponent(back)}`} className="mt-3 inline-flex min-h-12 items-center rounded-xl bg-brand-500 px-5 font-semibold text-white hover:bg-brand-600">
          Sign in to sell this card
        </Link>
      </div>
    );
  }

  const choose = (next: GiftCardSellOffer) => {
    setOfferId(next.id);
    setHow(next.form === "ecode" ? "code" : next.form === "physical" ? "photos" : how);
    setQuote(null);
    setError(null);
  };

  const addPhotos = async (files: FileList | null) => {
    if (!files?.length) return;
    setPreparing(true);
    setError(null);
    try {
      const added: File[] = [];
      for (const file of Array.from(files).slice(0, maxPhotos - photos.length)) {
        if (!/^image\//.test(file.type)) continue;
        // Scaled to 1600 px and saved again as JPEG: smaller to send, with no location or camera details.
        const small = await compressImage(file);
        added.push(new File([small], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: small.type || "image/jpeg" }));
      }
      setPhotos(current => [...current, ...added].slice(0, maxPhotos));
    } finally {
      setPreparing(false);
    }
  };

  const seePayout = () => {
    setError(null);
    startQuote(async () => {
      const result = await quoteSale(offer.id, value);
      if (result.ok) setQuote({ payout: result.payout, currency: result.currency, amount: value, offerId: offer.id });
      else setError({ message: result.message, code: result.code });
    });
  };

  const sell = async () => {
    if (!current) return;
    setSending(true);
    setError(null);
    const form = new FormData();
    form.set("offer_id", offer.id);
    form.set("amount", String(value));
    form.set("expected_payout", String(current.payout));
    form.set("key", key);
    if (how === "code") form.set("code", code.trim());
    else for (const photo of photos) form.append("photos", photo, photo.name);
    try {
      const res = await fetch("/api/gift-card-sales", { method: "POST", body: form });
      const body = (await res.json().catch(() => null)) as { id?: string; error?: { code?: string | null; message?: string } } | null;
      if (res.ok && body?.id) {
        router.push(`/account/sold/${body.id}`);
        return;
      }
      setError({ message: body?.error?.message ?? "Something went wrong. Try again.", code: body?.error?.code ?? null });
      if (body?.error?.code === "rate_changed") setQuote(null);
    } catch {
      setError({ message: "We could not reach the store. Try again shortly.", code: null });
    }
    setSending(false);
  };

  return (
    <div className="mt-6 space-y-5">
      {sandbox ? <p className="rounded-xl bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900">Sandbox: no card is sent and no real money is paid.</p> : null}

      {offers.length > 1 ? (
        <fieldset>
          <legend className="text-sm font-semibold">Which card is it?</legend>
          <div className="mt-2 grid gap-2">
            {offers.map(item => (
              <label key={item.id} className={optionClass}>
                <input type="radio" name={`${id}-offer`} checked={item.id === offer.id} onChange={() => choose(item)} className="accent-brand-500" />
                <span className="min-w-0 flex-1">{item.name}</span>
                <span className="text-sm text-slate-500">{money(item.rate, item.currency)} per 1</span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : (
        <p className="text-sm text-slate-600">
          <span className="font-semibold text-navy-900">{offer.name}</span> · {money(offer.rate, offer.currency)} for every 1 of its value
        </p>
      )}

      {offer.form === "both" ? (
        <fieldset>
          <legend className="text-sm font-semibold">What do you have?</legend>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label className={optionClass}>
              <input type="radio" name={`${id}-how`} checked={how === "photos"} onChange={() => setHow("photos")} className="sr-only" />
              <Camera className="size-4" aria-hidden="true" /> A physical card
            </label>
            <label className={optionClass}>
              <input type="radio" name={`${id}-how`} checked={how === "code"} onChange={() => setHow("code")} className="sr-only" />
              <KeyRound className="size-4" aria-hidden="true" /> An e-code
            </label>
          </div>
        </fieldset>
      ) : null}

      <div>
        <label htmlFor={`${id}-amount`} className="block text-sm font-semibold">
          The card’s value
        </label>
        <input
          id={`${id}-amount`}
          inputMode="numeric"
          value={amount}
          onChange={event => {
            setAmount(event.target.value.replace(/[^0-9]/g, "").slice(0, 5));
            setQuote(null);
          }}
          placeholder={`${offer.minimum} or more`}
          className="mt-1.5 block min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3.5 text-lg font-semibold focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
        />
        <p className="mt-1 text-sm text-slate-500">
          {amount && !valid ? `Enter a whole number from ${offer.minimum} to ${offer.maximum}.` : about ? `About ${money(about, offer.currency)} to your wallet.` : `From ${offer.minimum}.`}
        </p>
      </div>

      {how === "code" ? (
        <div>
          <label htmlFor={`${id}-code`} className="block text-sm font-semibold">
            The card’s code
          </label>
          <input
            id={`${id}-code`}
            value={code}
            onChange={event => setCode(event.target.value.slice(0, 200))}
            autoComplete="off"
            spellCheck={false}
            className="mt-1.5 block min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3.5 font-mono focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
          />
          <p className="mt-1 text-sm text-slate-500">Exactly as it is written, with its PIN if it has one. We never show it again.</p>
        </div>
      ) : (
        <div>
          <p className="text-sm font-semibold">Photos of the card</p>
          <p className="text-sm text-slate-500">Its front, and its back with the code scratched and showing. Up to {maxPhotos}.</p>
          {photos.length ? (
            <ul className="mt-2 flex flex-wrap gap-2">
              {photos.map((photo, index) => (
                <li key={`${photo.name}-${index}`} className="flex items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1.5 text-sm">
                  {photo.name}
                  <button type="button" onClick={() => setPhotos(current => current.filter((_, at) => at !== index))} className="rounded p-0.5 text-slate-500 hover:text-navy-900" aria-label={`Remove ${photo.name}`}>
                    <X className="size-3.5" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {photos.length < maxPhotos ? (
            <label className="mt-2 inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-dashed border-slate-300 px-4 font-semibold text-navy-900 hover:bg-slate-50">
              {preparing ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Camera className="size-4" aria-hidden="true" />}
              {photos.length ? "Add more photos" : "Add photos"}
              <input type="file" accept="image/jpeg,image/png,image/heic,image/webp" multiple className="sr-only" onChange={event => void addPhotos(event.target.files).then(() => (event.target.value = ""))} />
            </label>
          ) : null}
        </div>
      )}

      {offer.terms ? <p className="rounded-xl bg-slate-50 px-3.5 py-2.5 text-sm text-slate-600">{offer.terms}</p> : null}

      {error ? (
        <p role="alert" className="rounded-xl bg-red-50 px-3.5 py-3 text-sm text-red-800">
          {error.message}{" "}
          {error.code === "customer_verification_required" ? (
            <Link href={`/account/verification?next=${encodeURIComponent(back)}`} className="font-semibold underline">
              Verify your identity
            </Link>
          ) : null}
        </p>
      ) : null}

      {current ? (
        <div className="rounded-2xl bg-emerald-50 p-4">
          <p className="text-sm text-emerald-900">You get</p>
          <p className="font-display text-2xl font-extrabold text-emerald-900">{money(current.payout, current.currency)}</p>
          <p className="mt-1 text-sm text-emerald-900">Paid into your wallet once the card is checked and accepted. Nothing is paid before.</p>
          <button
            type="button"
            onClick={() => void sell()}
            disabled={sending || !ready}
            className="mt-3 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-500 px-5 font-semibold text-white hover:bg-brand-600 disabled:opacity-60"
          >
            {sending ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <ShieldCheck className="size-4" aria-hidden="true" />}
            Sell for {money(current.payout, current.currency)}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={seePayout}
          disabled={!ready || quoting || preparing}
          className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-500 px-5 font-semibold text-white hover:bg-brand-600 disabled:opacity-60"
        >
          {quoting ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : null}
          See what you get
        </button>
      )}
    </div>
  );
}
