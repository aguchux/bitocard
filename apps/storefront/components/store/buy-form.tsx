"use client";

import Link from "next/link";
import { useActionState, useId, useState } from "react";
import { Lock } from "lucide-react";
import { formatFace, type StoreCountry, type StorePaymentMethod, type StoreProductDetail } from "@bitocard/api-client/storefront";
import { type FormState, startCheckout } from "@/app/(store)/account/actions";
import { FormMessage, Submit, TextField } from "./account-forms";

/** Bought several at a time, each its own code. */
const multiples = new Set(["gift_cards", "software"]);
/** Delivered as codes or keys, which are also emailed. */
const emailed = new Set(["gift_cards", "software"]);

const optionClass =
  "flex cursor-pointer items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 font-display font-bold text-[#070f4c] has-[:checked]:border-[#ff2382] has-[:checked]:bg-pink-50 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[#ff2382]/40";

/**
 * Buying on a product page: the value, how many, who it is for, where the customer pays from and how. The price is
 * confirmed on the payment page; signing in comes first.
 */
export function BuyForm({
  product,
  countries,
  country,
  lockCountry = false,
  methods,
  signedIn,
  back,
  sandbox,
}: {
  product: StoreProductDetail;
  countries: StoreCountry[];
  country: string | null;
  /** A reseller's store sells in its own country: no choice of where to pay from. */
  lockCountry?: boolean;
  methods: StorePaymentMethod[];
  signedIn: boolean;
  back: string;
  sandbox: boolean;
}) {
  const id = useId();
  const [state, action, pending] = useActionState<FormState, FormData>(startCheckout, {});
  const values = product.denominations ?? [];
  const [market, setMarket] = useState(country ?? (product.global ? "" : product.country));

  if (!signedIn) {
    return (
      <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
        <p className="font-semibold">Sign in to buy</p>
        <p className="mt-1 text-sm text-slate-600">You need a free account, so your codes and receipts are kept safe for you.</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link href={`/signin?next=${encodeURIComponent(back)}`} className="inline-flex min-h-12 items-center rounded-xl bg-[#ff2382] px-5 font-semibold text-white hover:bg-[#e8116d]">
            Sign in
          </Link>
          <Link href={`/signup?next=${encodeURIComponent(back)}`} className="inline-flex min-h-12 items-center rounded-xl border border-slate-200 px-5 font-semibold text-[#070f4c] hover:border-slate-300">
            Create an account
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form action={action} className="mt-6 space-y-5 rounded-2xl border border-slate-200 bg-white p-5" aria-label={`Buy ${product.name}`}>
      <input type="hidden" name="product_id" value={product.id} />
      <input type="hidden" name="back" value={back} />
      <FormMessage state={state} />

      {values.length ? (
        <fieldset>
          <legend className="text-sm font-semibold">Value</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {values.map((value, index) => (
              <label key={value} className={optionClass}>
                <input type="radio" name="face_value_minor" value={value} defaultChecked={index === 0} className="sr-only" />
                {formatFace(value, product.face_currency)}
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
          state={state}
          hint={`From ${formatFace(product.range.min, product.face_currency)} to ${formatFace(product.range.max, product.face_currency)}.`}
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
        <TextField label="Mobile number" name="recipient_phone" type="tel" autoComplete="tel" required state={state} hint={`A ${product.country_name} number, for example with its country code.`} />
      ) : null}
      {product.recipient_type === "smartcard" || product.recipient_type === "meter" ? (
        <TextField
          label={product.recipient_type === "smartcard" ? "Smartcard or IUC number" : "Meter number"}
          name="recipient_account_number"
          inputMode="numeric"
          required
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
          onChange={event => setMarket(event.target.value)}
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

      {methods.length && market === country ? (
        <fieldset>
          <legend className="text-sm font-semibold">Pay with</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {methods.map((method, index) => (
              <label key={method.id} className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3 has-[:checked]:border-[#ff2382] has-[:checked]:bg-pink-50">
                <input type="radio" name="method" value={method.id} defaultChecked={index === 0} className="mt-1 accent-[#ff2382]" />
                <span>
                  <span className="block text-sm font-semibold">{method.label}</span>
                  <span className="block text-xs text-slate-500">{method.description}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      <Submit pending={pending} className="w-full text-lg sm:w-auto">
        <Lock className="size-4" aria-hidden="true" />
        {sandbox ? "Place a test order" : "Continue to payment"}
      </Submit>
      <p className="text-xs text-slate-500">
        {sandbox
          ? "Checkout is in test mode: no money is taken and codes are not real."
          : "You confirm the price on the secure payment page. If we cannot deliver your order, you are refunded in full."}
      </p>
    </form>
  );
}
