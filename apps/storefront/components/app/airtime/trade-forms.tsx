"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { ratePercent, type StoreAirtimeNetwork, type StoreAirtimeSeller } from "@bitocard/api-client/storefront";
import { FormMessage, Submit, TextField } from "@/components/store/account-forms";
import { type AirtimeBuyState, type AirtimeFormState, buyAirtime, startAirtimeSale } from "@/lib/airtime-actions";
import { buyerPays, nairaToMinor, sellerGets } from "@/lib/airtime-rules";
import { money } from "@/lib/money";
import { NetworkMark } from "./network-mark";

const quickAmounts = [500, 1_000, 2_000, 5_000];

/** The networks as a row of choices. The choice is sent from state (a hidden field), never from the controls. */
function NetworkChoice({ networks, value, onChange }: { networks: StoreAirtimeNetwork[]; value: string; onChange: (network: string) => void }) {
  return (
    <fieldset>
      <legend className="text-sm font-semibold">Network</legend>
      <input type="hidden" name="network" value={value} />
      <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {networks.map(network => (
          <button
            key={network.network}
            type="button"
            aria-pressed={value === network.network}
            disabled={!network.open}
            onClick={() => onChange(network.network)}
            className={`flex min-h-14 items-center gap-2 rounded-xl px-3 text-left text-sm font-semibold ring-1 disabled:opacity-50 ${value === network.network ? "bg-brand-50 ring-2 ring-brand-500" : "bg-white ring-slate-200 hover:ring-slate-300"}`}
          >
            <NetworkMark network={network.network} name={network.name} className="size-8" />
            {network.name}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/** The customer's confirmed numbers as choices (the default first); sent from state as a hidden field. */
function NumberChoice({ name, legend, phones, value, onChange }: { name: string; legend: string; phones: string[]; value: string; onChange: (phone: string) => void }) {
  return (
    <fieldset>
      <legend className="text-sm font-semibold">{legend}</legend>
      <input type="hidden" name={name} value={value} />
      <div className="mt-1 grid gap-2 sm:grid-cols-2">
        {phones.map((phone, index) => (
          <button
            key={phone}
            type="button"
            aria-pressed={value === phone}
            onClick={() => onChange(phone)}
            className={`flex min-h-12 items-center justify-between gap-2 rounded-xl px-3 text-left text-sm font-semibold ring-1 ${value === phone ? "bg-brand-50 ring-2 ring-brand-500" : "bg-white ring-slate-200 hover:ring-slate-300"}`}
          >
            <span>{phone}</span>
            {index === 0 ? <span className="text-xs font-medium text-slate-500">Default</span> : null}
          </button>
        ))}
      </div>
      <Link href="/account/profile/details" className="mt-2 inline-block text-sm font-semibold text-brand-600 hover:underline">
        Add or confirm another number
      </Link>
    </fieldset>
  );
}

/**
 * The warning a seller must read before sending: only a transfer from the confirmed number they chose can be matched
 * to their sale. Airtime from any other number cannot be traced to them, so it is not refunded and cannot be claimed.
 */
export function SendFromWarning({ phone }: { phone: string | null }) {
  return (
    <div role="note" className="rounded-2xl bg-red-50 p-4 text-sm text-red-900 ring-1 ring-red-200">
      <p className="flex items-center gap-2 font-bold">
        <TriangleAlert className="size-4 shrink-0" aria-hidden="true" /> Send only from {phone ?? "your confirmed number"}
      </p>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        <li>We match your airtime by the number it comes from. Send it from {phone ? <span className="font-semibold">{phone}</span> : "the confirmed number you chose"}, and no other line.</li>
        <li>Airtime sent from a number that is not confirmed on your account, or not the one you chose, cannot be matched to you. <span className="font-semibold">It is not refunded, it is lost, and it cannot be claimed.</span></li>
        <li>Send it on the same network as the number we show you, for exactly the amount of this sale.</li>
      </ul>
    </div>
  );
}

function QuickAmounts({ onPick }: { onPick: (naira: number) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {quickAmounts.map(naira => (
        <button key={naira} type="button" onClick={() => onPick(naira)} className="min-h-10 rounded-full px-3 text-sm font-semibold ring-1 ring-slate-200 hover:ring-slate-300">
          ₦{naira.toLocaleString("en-GB")}
        </button>
      ))}
    </div>
  );
}

/**
 * Selling airtime to BitoCard: the network and amount, what reaches the wallet after the hold, then the number to send
 * it to (on the sale's own page). It is sent only from one of the customer's confirmed numbers (the default first); a
 * customer without one is sent to confirm a number first.
 */
export function SellAirtimeForm({ networks, initial, phones, currency, seller = null }: { networks: StoreAirtimeNetwork[]; initial: string; phones: string[]; currency: string; seller?: StoreAirtimeSeller | null }) {
  const [state, action, pending] = useActionState<AirtimeFormState, FormData>(startAirtimeSale, {});
  const [network, setNetwork] = useState(initial);
  const [amount, setAmount] = useState("");
  const [from, setFrom] = useState(phones[0] ?? "");
  const chosen = networks.find(item => item.network === network);
  const minor = nairaToMinor(amount);
  const limit = seller?.networks.find(item => item.network === network);
  if (seller?.paused) {
    return (
      <div role="alert" className="rounded-3xl bg-red-50 p-5 text-red-900 ring-1 ring-red-200">
        <p className="font-semibold">Selling airtime is paused on your account</p>
        <p className="mt-1 text-sm">
          {`${seller.strike_limit} of your sales were not received or were reversed by the network, so you cannot sell airtime for now. If you think this is wrong, ask us on Help & support and we will look at your sales.`}
        </p>
        <Link href="/account/support" className="mt-3 inline-flex min-h-11 items-center rounded-xl bg-white px-4 font-semibold text-red-900 ring-1 ring-red-200 hover:ring-red-300">
          Help & support
        </Link>
      </div>
    );
  }
  if (!phones.length) {
    return (
      <div className="rounded-3xl bg-amber-50 p-5">
        <p className="font-semibold text-amber-900">Confirm your mobile number first</p>
        <p className="mt-1 text-sm text-amber-900">You can sell airtime only from a number confirmed on your account, so we can tell the airtime is yours.</p>
        <Link href="/account/profile/details" className="mt-3 inline-flex min-h-11 items-center rounded-xl bg-brand-500 px-4 font-semibold text-white hover:bg-brand-600">
          Confirm my number
        </Link>
      </div>
    );
  }
  return (
    <form action={action} className="space-y-5 rounded-3xl bg-white p-5 ring-1 ring-slate-200/70">
      <FormMessage state={state} />
      <NetworkChoice networks={networks} value={network} onChange={setNetwork} />
      <div className="space-y-2">
        <TextField label={`How much airtime (${currency})`} name="amount" inputMode="numeric" required value={amount} onChange={event => setAmount(event.target.value)} state={state} />
        <QuickAmounts onPick={naira => setAmount(String(naira))} />
      </div>
      {limit ? (
        <p className="text-sm text-slate-600">
          {limit.new_seller
            ? `As a new seller you can sell up to ${money(limit.daily_limit, currency)} of ${chosen?.name ?? "airtime"} a day, until ${limit.established_after} of your sales are complete. Then up to ${money(limit.seller_daily, currency)}.`
            : `You can sell up to ${money(limit.daily_limit, currency)} of ${chosen?.name ?? "airtime"} a day.`}
          {seller && seller.sold_today ? ` ${money(seller.sold_today, currency)} sold in the last 24 hours.` : ""}
        </p>
      ) : null}
      {seller && seller.strikes ? (
        <p className="rounded-2xl bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">
          {`You have ${seller.strikes} of ${seller.strike_limit} strikes: sales you said you sent that never arrived, or the network reversed. At ${seller.strike_limit}, selling is paused.`}
        </p>
      ) : null}
      <NumberChoice name="from_phone" legend="The number you send it from" phones={phones} value={from} onChange={setFrom} />
      <SendFromWarning phone={from} />
      {chosen && minor ? (
        <div className="rounded-2xl bg-slate-50 p-4" aria-live="polite">
          <p className="text-sm text-slate-600">You get, into your wallet</p>
          <p className="font-display text-2xl font-extrabold">{money(sellerGets(minor, chosen.sell_rate_bps), currency)}</p>
          <p className="mt-1 text-xs text-slate-500">
            {ratePercent(chosen.sell_rate_bps)} of {money(minor, currency)}, paid once your airtime arrives and a short hold has passed. Between {money(chosen.min_amount, currency)} and {money(chosen.max_amount, currency)} at a time.
          </p>
        </div>
      ) : null}
      <Submit pending={pending} className="w-full sm:w-auto">
        Get the number to send to
      </Submit>
    </form>
  );
}

/**
 * Buying airtime from the pool: the network, amount and number, then the price (nothing paid), then paying exactly
 * that price from the wallet. Changing anything asks for the price again.
 */
export function BuyAirtimeForm({ networks, initial, phones, currency, balance }: { networks: StoreAirtimeNetwork[]; initial: string; phones: string[]; currency: string; balance: number | null }) {
  const [state, action, pending] = useActionState<AirtimeBuyState, FormData>(buyAirtime, {});
  const [network, setNetwork] = useState(initial);
  const [amount, setAmount] = useState("");
  const [number, setNumber] = useState(phones[0] ?? "");
  const [stale, setStale] = useState(false);
  const quote = state.quote && !stale ? state.quote : null;
  const chosen = networks.find(item => item.network === network);
  const minor = nairaToMinor(amount);
  const change = <T,>(set: (value: T) => void) => (value: T) => {
    setStale(true);
    set(value);
  };
  if (!phones.length) {
    return (
      <div className="rounded-3xl bg-amber-50 p-5">
        <p className="font-semibold text-amber-900">Confirm your mobile number first</p>
        <p className="mt-1 text-sm text-amber-900">Airtime from the pool is sent only to a number confirmed on your account.</p>
        <Link href="/account/profile/details" className="mt-3 inline-flex min-h-11 items-center rounded-xl bg-brand-500 px-4 font-semibold text-white hover:bg-brand-600">
          Confirm my number
        </Link>
      </div>
    );
  }
  return (
    <form action={action} onSubmit={() => setStale(false)} className="space-y-5 rounded-3xl bg-white p-5 ring-1 ring-slate-200/70">
      <FormMessage state={stale ? {} : state} />
      <NetworkChoice networks={networks} value={network} onChange={change(setNetwork)} />
      {chosen ? (
        <p className="text-sm text-slate-600">
          {money(chosen.available, currency)} of {chosen.name} airtime is available now.
        </p>
      ) : null}
      <div className="space-y-2">
        <TextField label={`How much airtime (${currency})`} name="amount" inputMode="numeric" required value={amount} onChange={event => change(setAmount)(event.target.value)} state={stale ? {} : state} />
        <QuickAmounts onPick={naira => change(setAmount)(String(naira))} />
      </div>
      <NumberChoice name="phone" legend="Send it to" phones={phones} value={number} onChange={change(setNumber)} />
      <p className="text-xs text-slate-500">Check the number is on the network you chose: airtime sent to a number on another network cannot be taken back.</p>
      {quote ? (
        <div className="rounded-2xl bg-slate-50 p-4" aria-live="polite">
          <p className="text-sm text-slate-600">You pay</p>
          <p className="font-display text-2xl font-extrabold">{money(quote.price, quote.currency)}</p>
          <p className="mt-1 text-xs text-slate-500">
            For {money(quote.amount, quote.currency)} of airtime sent to {quote.phone} within the hour ({ratePercent(quote.rate_bps)} of its value), or your money back.
            {balance !== null ? ` Your ${currency} wallet has ${money(balance, currency)}.` : ""}
          </p>
          <input type="hidden" name="expected" value={quote.price} />
        </div>
      ) : chosen && minor ? (
        <p className="text-sm text-slate-600">About {money(buyerPays(minor, chosen.buy_rate_bps), currency)} from your wallet.</p>
      ) : null}
      <Submit pending={pending} className="w-full sm:w-auto">
        {quote ? `Pay ${money(quote.price, quote.currency)}` : "See the price"}
      </Submit>
      {quote && balance !== null && balance < quote.price ? (
        <p className="text-sm">
          <Link href={`/account/wallet?amount=${Math.ceil((quote.price - balance) / 100)}`} className="font-semibold text-brand-600 hover:underline">
            Add money to your wallet
          </Link>{" "}
          first: it is {money(quote.price - balance, currency)} short.
        </p>
      ) : null}
    </form>
  );
}
