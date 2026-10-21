"use client";

import { useActionState, useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { Lock, Wallet } from "lucide-react";
import type { StoreProduct, StoreWallet } from "@bitocard/api-client/storefront";
import { formatFace } from "@bitocard/api-client/storefront";
import { type FormState, startCheckout } from "@/lib/account-actions";
import { detectNetwork, topUpProducts } from "@/lib/topup";
import { BrandImage } from "./brand-image";
import { FormMessage, Submit, TextField } from "./account-forms";

type Category = "airtime" | "data";
const tabs: Array<{ category: Category; label: string }> = [
  { category: "airtime", label: "Airtime" },
  { category: "data", label: "Data" },
];

/** The store's server is asked again this long after the customer stops typing a number. */
const detectDelayMs = 500;

/**
 * Top up a number in two fields: the network is detected from the number itself (the routed supplier's own lookup,
 * else a guess from its prefix), never a list of bundles to pick through first. Falls back to a network choice only
 * when neither can tell. Paid straight from the wallet, as `BuyForm`'s wallet flow does.
 */
export function TopUpForm({ country, currency, wallet, signedIn, back }: { country: string; currency?: string; wallet: StoreWallet | null; signedIn: boolean; back: string }) {
  const id = useId();
  const [state, action, pending] = useActionState<FormState, FormData>(startCheckout, {});
  const [category, setCategory] = useState<Category>("airtime");
  const [phone, setPhone] = useState("");
  const [guess, setGuess] = useState<{ detected: boolean; product: StoreProduct | null }>({ detected: false, product: null });
  const [networks, setNetworks] = useState<StoreProduct[] | null>(null);
  const [chosenBrand, setChosenBrand] = useState("");
  const [dataBundles, setDataBundles] = useState<StoreProduct[] | null>(null);
  const [chosenBundle, setChosenBundle] = useState("");
  const [amount, setAmount] = useState("");
  const [detecting, startDetecting] = useTransition();
  const [loadingNetworks, startLoadingNetworks] = useTransition();
  const [loadingBundles, startLoadingBundles] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);

  // A fresh number (or switching tab) clears what was resolved for the last one.
  useEffect(() => {
    setGuess({ detected: false, product: null });
    setNetworks(null);
    setChosenBrand("");
    setDataBundles(null);
    setChosenBundle("");
    if (timer.current) clearTimeout(timer.current);
    if (phone.trim().length < 6) return;
    timer.current = setTimeout(() => {
      startDetecting(async () => setGuess(await detectNetwork(phone, country, category, currency)));
    }, detectDelayMs);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-detect only when the number or tab changes, not every render
  }, [phone, category, country, currency]);

  // Detection failed: offer every network on sale, so the customer picks one instead.
  useEffect(() => {
    if (guess.detected || detecting || phone.trim().length < 6 || networks) return;
    startLoadingNetworks(async () => setNetworks(await topUpProducts(category, country, currency)));
  }, [guess.detected, detecting, phone, networks, category, country, currency]);

  const brands = useMemo(() => {
    const seen = new Map<string, StoreProduct>();
    for (const product of networks ?? []) if (!seen.has(product.brand.slug)) seen.set(product.brand.slug, product);
    return [...seen.values()];
  }, [networks]);

  const manualProduct = chosenBrand ? (networks ?? []).find(product => product.brand.slug === chosenBrand) : null;

  // Data: once the network is known, load that network's bundles (its own products) to choose from.
  useEffect(() => {
    const brand = guess.product?.brand.slug ?? manualProduct?.brand.slug;
    if (category !== "data" || !brand || dataBundles) return;
    startLoadingBundles(async () => {
      const all = await topUpProducts("data", country, currency);
      setDataBundles(all.filter(item => item.brand.slug === brand));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once per resolved brand
  }, [category, guess.product, manualProduct, country, currency, dataBundles]);

  const product = category === "data" ? (dataBundles ?? []).find(item => item.key === chosenBundle) : (guess.product ?? manualProduct);
  const network = guess.detected ? guess.product?.brand : manualProduct?.brand;
  const preview = state.preview && state.preview.quote_id !== dismissed ? state.preview : null;
  const payOption = preview?.wallet_options?.find(option => option.enough) ?? preview?.wallet_options?.[0];
  const walletReady = wallet && wallet.enabled;
  const fieldLabel = "block text-sm font-semibold text-navy-900";

  if (!signedIn) {
    return <p className="text-sm text-slate-600">Sign in to top up from your wallet.</p>;
  }

  return (
    <form action={action} onChange={() => state.preview && setDismissed(state.preview.quote_id)} className="space-y-5 rounded-3xl bg-white p-5 ring-1 ring-slate-200/70 sm:p-6" aria-label="Top up">
      {product ? <input type="hidden" name="product_id" value={product.id} /> : null}
      <input type="hidden" name="back" value={back} />
      <input type="hidden" name="country" value={country} />
      <input type="hidden" name="wallet_required" value="1" />
      {preview ? <input type="hidden" name="quote_id" value={preview.quote_id} /> : null}
      {preview && payOption ? <input type="hidden" name="wallet_currency" value={payOption.currency} /> : null}

      <div role="tablist" aria-label="What to top up" className="flex gap-2">
        {tabs.map(tab => (
          <button
            key={tab.category}
            type="button"
            role="tab"
            aria-selected={tab.category === category}
            onClick={() => {
              setCategory(tab.category);
              setDismissed(null);
            }}
            className={`min-h-10 rounded-full px-4 text-sm font-semibold transition ${tab.category === category ? "bg-brand-500 text-white" : "bg-white text-navy-900 ring-1 ring-slate-200 hover:ring-slate-300"}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <FormMessage state={state} />
      {state.field === "wallet" ? (
        <a href="/account/wallet" className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-navy-900 px-4 text-sm font-semibold text-white hover:bg-navy-800">
          <Wallet className="size-4" aria-hidden="true" /> Top up your wallet
        </a>
      ) : null}

      <TextField
        label="Mobile number"
        name="recipient_phone"
        type="tel"
        autoComplete="tel"
        required
        value={phone}
        onChange={event => setPhone(event.target.value)}
        state={state}
        hint="We find the network from the number."
      />

      {detecting ? (
        <p className="text-sm text-slate-500" aria-live="polite">
          Finding the network…
        </p>
      ) : network ? (
        <div className="flex items-center gap-2.5 rounded-xl bg-slate-50 px-3.5 py-2.5" role="status">
          <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-lg bg-white" style={{ backgroundColor: network.color ?? undefined }}>
            {network.logo_url ? (
              <BrandImage src={network.logo_url} className="size-6 object-contain" fallback={<span className="text-[10px] font-extrabold text-navy-900">{network.initials}</span>} />
            ) : (
              <span className="text-[10px] font-extrabold text-navy-900">{network.initials}</span>
            )}
          </span>
          <span className="text-sm font-semibold text-navy-900">{network.name}</span>
        </div>
      ) : phone.trim().length >= 6 ? (
        <div className="space-y-1.5">
          <label htmlFor={`${id}-network`} className={fieldLabel}>
            Network
          </label>
          {loadingNetworks ? (
            <p className="text-sm text-slate-500">Finding networks…</p>
          ) : brands.length ? (
            <select
              id={`${id}-network`}
              value={chosenBrand}
              onChange={event => {
                setChosenBrand(event.target.value);
                setDataBundles(null);
                setChosenBundle("");
              }}
              className="min-h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-[15px] text-navy-900"
              required
            >
              <option value="" disabled>
                Choose a network
              </option>
              {brands.map(item => (
                <option key={item.brand.slug} value={item.brand.slug}>
                  {item.brand.name}
                </option>
              ))}
            </select>
          ) : (
            <p className="text-sm text-slate-500">No {category === "data" ? "data bundles" : "airtime"} on sale here yet.</p>
          )}
        </div>
      ) : null}

      {category === "airtime" && product ? (
        <TextField label={`Amount (${product.face_currency})`} name="face_value" inputMode="decimal" required value={amount} onChange={event => setAmount(event.target.value)} state={state} />
      ) : category === "data" && network ? (
        <div className="space-y-1.5">
          <label htmlFor={`${id}-bundle`} className={fieldLabel}>
            Bundle
          </label>
          {loadingBundles || !dataBundles ? (
            <p className="text-sm text-slate-500">Finding bundles…</p>
          ) : dataBundles.length ? (
            <select id={`${id}-bundle`} value={chosenBundle} onChange={event => setChosenBundle(event.target.value)} className="min-h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-[15px] text-navy-900" required>
              <option value="" disabled>
                Choose a bundle
              </option>
              {dataBundles.map(item => (
                <option key={item.key} value={item.key}>
                  {item.name} · {item.price ? formatFace(item.price.from, item.price.currency) : formatFace(item.from, item.face_currency)}
                </option>
              ))}
            </select>
          ) : (
            <p className="text-sm text-slate-500">No data bundles on sale for this network yet.</p>
          )}
        </div>
      ) : null}

      {preview && payOption ? (
        <div className="space-y-3 rounded-2xl bg-slate-50 p-4" role="status">
          <p className="text-sm text-slate-600">You pay</p>
          <p className="font-display text-3xl font-extrabold text-navy-900">{formatFace(preview.amount, preview.currency)}</p>
          {payOption.enough ? (
            <div className="flex flex-wrap gap-3">
              <Submit pending={pending} className="text-lg">
                <Wallet className="size-4" aria-hidden="true" /> Pay {formatFace(payOption.amount ?? preview.amount, payOption.currency)}
              </Submit>
              <button type="button" onClick={() => setDismissed(preview.quote_id)} className="inline-flex min-h-12 items-center rounded-xl px-4 font-semibold text-slate-600 hover:text-navy-900">
                Change
              </button>
            </div>
          ) : (
            <a href="/account/wallet" className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-navy-900 px-5 font-semibold text-white hover:bg-navy-800">
              <Wallet className="size-4" aria-hidden="true" /> Top up your wallet
            </a>
          )}
        </div>
      ) : (
        <Submit pending={pending || !product} className="w-full text-lg sm:w-auto">
          {walletReady ? <Wallet className="size-4" aria-hidden="true" /> : <Lock className="size-4" aria-hidden="true" />}
          See the price
        </Submit>
      )}
      <p className="text-xs text-slate-500">You see the price before it is taken from your wallet. If we cannot deliver it, it goes back to your wallet in full.</p>
    </form>
  );
}
