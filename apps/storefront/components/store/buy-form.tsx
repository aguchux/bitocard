"use client";

import Link from "next/link";
import { useActionState, useId, useMemo, useState, useSyncExternalStore, useTransition } from "react";
import { Lock, Wallet } from "lucide-react";
import { formatFace, localFace, type StoreCountry, type StorePaymentMethod, type StoreProductDetail, type StoreWallet } from "@bitocard/api-client/storefront";
import { type FormState, startCheckout } from "@/lib/account-actions";
import { type PaymentChoice, paymentMethodsFor } from "@/lib/payment-methods";
import { prefillFrom } from "@/lib/quick-buy";
import { FormMessage, Submit, TextField } from "./account-forms";

/** Bought several at a time, each its own code. */
const multiples = new Set(["gift_cards", "software"]);
/** Delivered as codes or keys, which are also emailed. */
const emailed = new Set(["gift_cards", "software"]);

const optionClass =
  "flex cursor-pointer items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 font-display font-bold text-navy-900 has-[:checked]:border-brand-500 has-[:checked]:bg-pink-50 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-500/40";

const walletOption: StorePaymentMethod = { object: "payment_method", id: "wallet", label: "Wallet", description: "Pay from your wallet balance", networks: [] };

/** The wallet page (the country wallet, or `wallet` USD), coming back here. */
const topUpHref = (back: string, wallet?: string) => `/account/wallet?${new URLSearchParams({ ...(wallet ? { wallet } : {}), back }).toString()}`;

/** A value in the customer's own currency first (their prices), with the card's own value beneath. */
function FaceValue({ value, product }: { value: number; product: StoreProductDetail }) {
  const local = localFace(value, product);
  if (!local) return <>{formatFace(value, product.face_currency)}</>;
  return (
    <span className="flex flex-col items-center leading-tight">
      <span>{formatFace(local.amount, local.currency)}</span>
      <span className="text-xs font-semibold text-slate-500">{formatFace(value, product.face_currency)} value</span>
    </span>
  );
}

/** ", about ₦15,000 to ₦1,500,000" for a range in another currency. */
function rangeInLocal(product: StoreProductDetail) {
  const min = product.range && localFace(product.range.min, product);
  const max = product.range && localFace(product.range.max, product);
  return min && max ? `, about ${formatFace(min.amount, min.currency)} to ${formatFace(max.amount, max.currency)}` : "";
}

/** The page's address does not change under the form, so there is nothing to listen to. */
const noSubscription = () => () => {};

/**
 * Buying on a product page: the value, how many, who it is for, where the customer pays from and how. With wallets on
 * the customer pays from their wallet (topping it up first); otherwise the price is confirmed on the payment page, and
 * a balance left in the wallet can still be spent. Signing in comes first.
 */
export function BuyForm({
  product,
  countries,
  country,
  lockCountry = false,
  methods,
  walletRequired = false,
  wallet = null,
  signedIn,
  back,
  sandbox,
}: {
  product: StoreProductDetail;
  countries: StoreCountry[];
  country: string | null;
  /** A reseller's store sells in its own country, and a signed-in customer pays in their own: no choice of where to pay from. */
  lockCountry?: boolean;
  methods: StorePaymentMethod[];
  /** Wallets are on: the wallet is the only way to pay. */
  walletRequired?: boolean;
  /** The signed-in customer's wallet (in their own country's currency). */
  wallet?: StoreWallet | null;
  signedIn: boolean;
  back: string;
  sandbox: boolean;
}) {
  const id = useId();
  const [state, action, pending] = useActionState<FormState, FormData>(startCheckout, {});
  // Quick buy opens this page with the number (and amount) in its address: they start the form.
  const search = useSyncExternalStore(noSubscription, () => window.location.search, () => "");
  const prefill = useMemo(() => prefillFrom(search), [search]);
  const values = product.denominations ?? [];
  const [market, setMarket] = useState(country ?? (product.global ? "" : product.country));
  // The country the last attempt was for: its error is hidden once the shopper picks another country.
  const [tried, setTried] = useState(market);
  // The payment methods for the country chosen: the page's own country comes with the page; another is asked for.
  const [shown, setShown] = useState<PaymentChoice & { country: string | null }>({ country, methods, walletRequired, wallet });
  const [loadingMethods, startLoading] = useTransition();
  const chooseMarket = (next: string) => {
    setMarket(next);
    if (next === shown.country) return;
    if (next === country) return setShown({ country, methods, walletRequired, wallet });
    startLoading(async () => setShown({ country: next, ...(await paymentMethodsFor(next)) }));
  };
  // A balance left after wallets were switched off can still be spent.
  const offered = !shown.walletRequired && shown.wallet && shown.wallet.balance > 0 ? [walletOption, ...shown.methods] : shown.methods;
  const payingFromWallet = shown.walletRequired || (offered[0]?.id === "wallet" && offered.length === 1);
  // The price quoted for paying from the wallet, until the customer changes anything in the form.
  const [dismissed, setDismissed] = useState<string | null>(null);
  const preview = market === tried && state.preview && state.preview.quote_id !== dismissed ? state.preview : null;
  // Which wallet pays the price shown: chosen by the customer, else the first that covers it, else the country wallet.
  const [payFrom, setPayFrom] = useState<string | null>(null);
  const options = preview?.wallet_options ?? [];
  const payOption = options.find(option => option.currency === payFrom && option.amount !== null) ?? options.find(option => option.enough) ?? options[0];

  if (!signedIn) {
    return (
      <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
        <p className="font-semibold">Sign in to buy</p>
        <p className="mt-1 text-sm text-slate-600">You need a free account, so your codes and receipts are kept safe for you.</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link href={`/signin?next=${encodeURIComponent(back)}`} className="inline-flex min-h-12 items-center rounded-xl bg-brand-500 px-5 font-semibold text-white hover:bg-brand-600">
            Sign in
          </Link>
          <Link href={`/signup?next=${encodeURIComponent(back)}`} className="inline-flex min-h-12 items-center rounded-xl border border-slate-200 px-5 font-semibold text-navy-900 hover:border-slate-300">
            Create an account
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form action={action} onSubmit={() => setTried(market)} onChange={() => state.preview && setDismissed(state.preview.quote_id)} className="mt-6 space-y-5 rounded-2xl border border-slate-200 bg-white p-5" aria-label={`Buy ${product.name}`}>
      <input type="hidden" name="product_id" value={product.id} />
      <input type="hidden" name="back" value={back} />
      {shown.walletRequired ? <input type="hidden" name="wallet_required" value="1" /> : null}
      {preview ? <input type="hidden" name="quote_id" value={preview.quote_id} /> : null}
      {market === tried ? <FormMessage state={state} /> : null}
      {market === tried && state.field === "wallet" ? (
        <Link href={topUpHref(back)} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-navy-900 px-4 text-sm font-semibold text-white hover:bg-navy-800">
          <Wallet className="size-4" aria-hidden="true" /> Top up your wallet
        </Link>
      ) : null}

      {values.length ? (
        <fieldset>
          <legend className="text-sm font-semibold">Value</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {values.map((value, index) => (
              <label key={value} className={optionClass}>
                <input type="radio" name="face_value_minor" value={value} defaultChecked={index === 0} className="sr-only" />
                <FaceValue value={value} product={product} />
              </label>
            ))}
          </div>
        </fieldset>
      ) : product.range ? (
        <TextField
          label={`Amount (${product.face_currency})`}
          name="face_value"
          inputMode="decimal"
          required
          key={`amount-${prefill.amount}`}
          defaultValue={prefill.amount}
          state={state}
          hint={`From ${formatFace(product.range.min, product.face_currency)} to ${formatFace(product.range.max, product.face_currency)}${rangeInLocal(product)}.`}
        />
      ) : null}

      {multiples.has(product.category) ? (
        <div className="space-y-1.5">
          <label htmlFor={`${id}-quantity`} className="block text-sm font-semibold">
            How many
          </label>
          <select id={`${id}-quantity`} name="quantity" defaultValue="1" className="min-h-12 w-28 rounded-xl border border-slate-200 bg-white px-3 text-[15px]">
            {Array.from({ length: 10 }, (_, index) => index + 1).map(count => (
              <option key={count} value={count}>
                {count}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {product.recipient_type === "phone" ? (
        <TextField key={`phone-${prefill.number}`} defaultValue={prefill.number} label="Mobile number" name="recipient_phone" type="tel" autoComplete="tel" required state={state} hint={`A ${product.country_name} number, for example with its country code.`} />
      ) : null}
      {product.recipient_type === "smartcard" || product.recipient_type === "meter" ? (
        <TextField
          label={product.recipient_type === "smartcard" ? "Smartcard or IUC number" : "Meter number"}
          name="recipient_account_number"
          inputMode="numeric"
          required
          key={`account-${prefill.number}`}
          defaultValue={prefill.number}
          state={state}
          hint="We check it with the provider before you pay."
        />
      ) : null}
      {emailed.has(product.category) ? (
        <TextField label="Send the codes to (optional)" name="recipient_email" type="email" state={state} hint="Leave empty to use your account email. Codes are also kept in your orders." />
      ) : null}

      {lockCountry && country ? (
        <input type="hidden" name="country" value={country} />
      ) : (
      <div className="space-y-1.5">
        <label htmlFor={`${id}-country`} className="block text-sm font-semibold">
          Paying from
        </label>
        <select
          id={`${id}-country`}
          name="country"
          required
          value={market}
          onChange={event => chooseMarket(event.target.value)}
          className="min-h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-[15px] sm:w-72"
          aria-invalid={state.field === "country" || undefined}
        >
          <option value="" disabled>
            Choose your country
          </option>
          {countries.map(item => (
            <option key={item.code} value={item.code}>
              {item.name}
            </option>
          ))}
        </select>
        <p className="text-xs text-slate-500">You pay in its currency, with the methods available there.</p>
      </div>
      )}

      {loadingMethods ? (
        <p className="text-sm text-slate-500" aria-live="polite">
          Finding how you can pay from there…
        </p>
      ) : offered.length && market === shown.country ? (
        <fieldset>
          <legend className="text-sm font-semibold">Pay with</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {offered.map((method, index) => (
              <label key={method.id} className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3 has-[:checked]:border-brand-500 has-[:checked]:bg-pink-50">
                <input type="radio" name="method" value={method.id} defaultChecked={index === 0} className="mt-1 accent-brand-500" />
                <span>
                  <span className="block text-sm font-semibold">{method.label}</span>
                  <span className="block text-xs text-slate-500">{method.description}</span>
                  {method.id === "wallet" && shown.wallet ? (
                    <span className="mt-1.5 block text-xs">
                      <span className="font-semibold text-navy-900">Balance {formatFace(shown.wallet.balance, shown.wallet.currency)}</span>
                      {shown.wallet.enabled ? (
                        <>
                          {" · "}
                          <Link href={topUpHref(back)} className="font-semibold text-brand-500 underline-offset-2 hover:underline">
                            Top up
                          </Link>
                        </>
                      ) : null}
                    </span>
                  ) : null}
                  {method.networks?.length ? (
                    <span className="mt-1.5 flex flex-wrap gap-1" aria-label={`Networks: ${method.networks.join(", ")}`}>
                      {method.networks.map(network => (
                        <span key={network} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                          {network}
                        </span>
                      ))}
                    </span>
                  ) : null}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      {preview && payOption ? (
        <div className="space-y-3 rounded-2xl bg-slate-50 p-4" role="status">
          <p className="text-sm text-slate-600">You pay</p>
          <p className="font-display text-3xl font-extrabold text-navy-900">{formatFace(preview.amount, preview.currency)}</p>
          {options.length > 1 ? (
            // Which wallet pays: kept out of the form's change handler, which would drop the price shown.
            <fieldset onChange={event => event.stopPropagation()}>
              <legend className="text-sm font-semibold">Pay from</legend>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {options.map(option => (
                  <label
                    key={option.currency}
                    className={`flex items-start gap-3 rounded-xl border bg-white p-3 ${option.amount === null ? "cursor-not-allowed opacity-60" : "cursor-pointer"} border-slate-200 has-[:checked]:border-brand-500 has-[:checked]:bg-pink-50`}
                  >
                    <input
                      type="radio"
                      name="wallet_currency"
                      value={option.currency}
                      checked={payOption.currency === option.currency}
                      disabled={option.amount === null}
                      onChange={() => setPayFrom(option.currency)}
                      className="mt-1 accent-brand-500"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold">{option.currency === preview.currency ? `${option.currency} wallet` : "US dollar wallet"}</span>
                      <span className="block text-sm text-navy-900">{option.amount === null ? "Not available right now" : formatFace(option.amount, option.currency)}</span>
                      <span className={`block text-xs ${option.enough ? "text-slate-500" : "text-amber-700"}`}>Balance {formatFace(option.balance, option.currency)}</span>
                    </span>
                  </label>
                ))}
              </div>
              {payOption.currency !== preview.currency && payOption.amount !== null ? (
                <p className="mt-2 text-xs text-slate-500">Converted at our exchange rate. A refund goes back to your US dollar wallet in full.</p>
              ) : null}
            </fieldset>
          ) : (
            <>
              <input type="hidden" name="wallet_currency" value={payOption.currency} />
              <p className="text-sm text-slate-600">
                From your wallet: {formatFace(payOption.balance, payOption.currency)}
                {payOption.enough && payOption.amount !== null ? `, leaving ${formatFace(payOption.balance - payOption.amount, payOption.currency)}.` : "."}
              </p>
            </>
          )}
          {payOption.enough && payOption.amount !== null ? (
            <div className="flex flex-wrap gap-3">
              <Submit pending={pending} className="text-lg">
                <Wallet className="size-4" aria-hidden="true" /> Pay {formatFace(payOption.amount, payOption.currency)}
              </Submit>
              <button type="button" onClick={() => setDismissed(preview.quote_id)} className="inline-flex min-h-12 items-center rounded-xl px-4 font-semibold text-slate-600 hover:text-navy-900">
                Change
              </button>
            </div>
          ) : (
            <Link
              href={topUpHref(back, payOption.currency === preview.currency ? undefined : payOption.currency)}
              className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-navy-900 px-5 font-semibold text-white hover:bg-navy-800"
            >
              <Wallet className="size-4" aria-hidden="true" /> Top up {formatFace((payOption.amount ?? 0) - payOption.balance, payOption.currency)} or more
            </Link>
          )}
        </div>
      ) : (
        <Submit pending={pending} className="w-full text-lg sm:w-auto">
          {payingFromWallet ? <Wallet className="size-4" aria-hidden="true" /> : <Lock className="size-4" aria-hidden="true" />}
          {sandbox && !payingFromWallet ? "Place a test order" : payingFromWallet ? "See the price" : "Continue to payment"}
        </Submit>
      )}
      <p className="text-xs text-slate-500">
        {sandbox
          ? "Checkout is in test mode: no money is taken and codes are not real."
          : payingFromWallet
            ? "You see the price before it is taken from your wallet. If we cannot deliver your order, it goes back to your wallet in full."
            : "You confirm the price on the secure payment page. If we cannot deliver your order, you are refunded in full."}
      </p>
    </form>
  );
}
