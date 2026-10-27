"use client";

import { type ChangeEvent, type ReactNode, useActionState, useEffect, useState } from "react";
import { formatFace } from "@bitocard/api-client/storefront";
import { ArrowDownLeft, ArrowUpRight, Check, Copy, Mail, Plus, Send, Zap } from "lucide-react";
import { initialSource, type ReservePrices } from "@/lib/exchange";
import { FormMessage, Submit, TextField } from "@/components/store/account-forms";
import type { FormState } from "@/lib/account-actions";
import {
  addCashOutAccount,
  addTestCrypto,
  addWithdrawalAddress,
  bestP2pPrice,
  cashOut,
  chooseNickname,
  confirmTrade,
  confirmWithdrawal,
  createWithdrawal,
  findBestPrice,
  type NonceFormState,
  postAd,
  repriceAd,
  resendWithdrawalCode,
  reviewWithdrawal,
  takeAd,
} from "@/lib/crypto-actions";

const selectClass = "min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-navy-900 focus:border-brand-500 focus:ring-2 focus:ring-pink-100 focus:outline-none";

/** Buy or sell, as a two-button switch that works as radios (so the form posts without script). */
function SideSwitch({ name = "side", value, onChange, labels = { buy: "Buy", sell: "Sell" } }: { name?: string; value: "buy" | "sell"; onChange: (side: "buy" | "sell") => void; labels?: { buy: string; sell: string } }) {
  return (
    <fieldset className="grid grid-cols-2 gap-1 rounded-2xl bg-slate-100 p-1">
      <legend className="sr-only">Buy or sell</legend>
      {(["buy", "sell"] as const).map(side => (
        <label
          key={side}
          className={`flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-xl text-sm font-bold has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-500 ${
            value === side ? (side === "buy" ? "bg-emerald-600 text-white shadow-sm" : "bg-brand-500 text-white shadow-sm") : "text-slate-600"
          }`}
        >
          <input type="radio" name={name} value={side} checked={value === side} onChange={() => onChange(side)} className="sr-only" />
          {side === "buy" ? <ArrowDownLeft className="size-4" aria-hidden="true" /> : <ArrowUpRight className="size-4" aria-hidden="true" />}
          {labels[side]}
        </label>
      ))}
    </fieldset>
  );
}

function AssetSelect({ assets, defaultValue, name = "asset", label = "Coin", value, onChange }: { assets: string[]; defaultValue?: string; name?: string; label?: string; value?: string; onChange?: (asset: string) => void }) {
  const controlled = value !== undefined ? { value, onChange: (event: ChangeEvent<HTMLSelectElement>) => onChange?.(event.target.value) } : { defaultValue: defaultValue ?? assets[0] };
  return (
    <label className="block space-y-1.5">
      <span className="block text-sm font-semibold text-navy-900">{label}</span>
      <select name={name} {...controlled} className={selectClass}>
        {assets.map(asset => (
          <option key={asset} value={asset}>
            {asset}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Copies text (an address) with one tap, saying so. */
export function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => void navigator.clipboard.writeText(text).then(() => setCopied(true), () => setCopied(false))}
      className="inline-flex min-h-11 items-center gap-2 rounded-xl px-4 font-semibold text-navy-900 ring-1 ring-slate-300 hover:ring-slate-400"
    >
      {copied ? <Check className="size-4 text-emerald-600" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
      {copied ? "Copied" : label}
    </button>
  );
}

/**
 * One button that changes something (pause an ad, cancel a withdrawal, remove an account), with the API's reason
 * shown beside it when it is refused.
 */
export function ActionButton({
  action,
  fields,
  children,
  className,
  label,
}: {
  action: (state: FormState, form: FormData) => Promise<FormState>;
  fields: Record<string, string>;
  children: ReactNode;
  className: string;
  /** The button's accessible name, when it shows only an icon. */
  label?: string;
}) {
  const [state, run, pending] = useActionState<FormState, FormData>(action, {});
  return (
    <form action={run} className="inline-flex flex-col items-start gap-1">
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <button type="submit" disabled={pending} aria-label={label} className={`${className} disabled:opacity-60`}>
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

type Source = "reserve" | "p2p";

/**
 * Quick buy or sell: buy or sell, the coin, where from (BitoCard's reserve, the instant exchange at its live price, or
 * traders on the P2P market at the best ad's price; both shown with their price, nothing hidden) and how much in the
 * customer's currency. The reserve opens the exchange with the amount filled in; traders go to the best ad's confirmation.
 */
export function QuickTrade({
  assets,
  currency,
  defaultAsset,
  defaultSide = "buy",
  reserve = {},
  desk = "BitoCard",
  p2p = true,
}: {
  assets: string[];
  currency: string;
  defaultAsset?: string;
  defaultSide?: "buy" | "sell";
  /** The reserve's prices per coin and side (`reservePrices`); empty where the instant exchange is not offered. */
  reserve?: ReservePrices;
  desk?: string;
  /** Whether P2P trading is open to the customer (a separate market from the instant exchange). */
  p2p?: boolean;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(findBestPrice, {});
  const [side, setSide] = useState<"buy" | "sell">(defaultSide);
  const [asset, setAsset] = useState(defaultAsset && assets.includes(defaultAsset) ? defaultAsset : (assets[0] ?? ""));
  const reservePrice = reserve[asset]?.[side] ?? null;
  const [chosen, setChosen] = useState<Source | null>(null);
  // The reserve while it has a price for this coin and side (unless the customer chose traders), else traders.
  const source: Source = !p2p ? "reserve" : reservePrice === null ? "p2p" : (chosen ?? initialSource(reserve, asset, side));
  // Nothing to trade on: P2P closed to them and the reserve has no price for this coin and side.
  const unavailable = source === "reserve" && reservePrice === null;
  // The best P2P price per coin and side, asked once each (undefined while asking, null with no ad).
  const [prices, setPrices] = useState<Record<string, number | null>>({});
  const key = `${asset}:${side}`;
  // Where the store offers no instant exchange, traders are the only source and the choice is not shown.
  const offered = Object.keys(reserve).length > 0;
  useEffect(() => {
    if (!offered || !p2p || !asset || key in prices) return;
    let current = true;
    void bestP2pPrice(asset, side).then(
      price => current && setPrices(known => ({ ...known, [key]: price })),
      () => current && setPrices(known => ({ ...known, [key]: null })),
    );
    return () => {
      current = false;
    };
  }, [offered, p2p, asset, side, key, prices]);
  const p2pPrice = p2p ? prices[key] : null;
  const priceText = (price: number | null | undefined, none: string) => (price === undefined ? "Checking the price…" : price === null ? none : `${formatFace(price, currency)} per ${asset}`);
  const options: { value: Source; title: string; note: string; price: string; disabled: boolean }[] = [
    { value: "reserve", title: `From ${desk}'s reserve`, note: "Instant, at the live market price", price: priceText(reservePrice, "Not available for this coin right now"), disabled: reservePrice === null },
    { value: "p2p", title: "From traders (P2P)", note: side === "buy" ? "The cheapest ad for your amount" : "The best-paying ad for your amount", price: p2p ? priceText(p2pPrice, "No ads right now") : "P2P trading is not open to you", disabled: !p2p },
  ];

  return (
    <form action={action} className="space-y-4" aria-label="Quick trade">
      <SideSwitch value={side} onChange={setSide} />
      <FormMessage state={state} />
      <AssetSelect assets={assets} value={asset} onChange={setAsset} />
      {offered ? (
      <fieldset className="space-y-2">
        <legend className="mb-1.5 text-sm font-semibold text-navy-900">Where from</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {options.map(option => (
            <label
              key={option.value}
              className={`flex min-h-11 min-w-0 items-start gap-3 rounded-2xl p-3 ring-1 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-500 ${
                option.disabled ? "cursor-not-allowed opacity-60 ring-slate-200" : source === option.value ? "cursor-pointer bg-brand-50 ring-brand-300" : "cursor-pointer ring-slate-200 hover:ring-slate-300"
              }`}
            >
              <input type="radio" name="source" value={option.value} checked={source === option.value} disabled={option.disabled} onChange={() => setChosen(option.value)} className="mt-1 size-4 shrink-0 accent-brand-500" />
              <span className="min-w-0">
                <span className="block font-semibold">{option.title}</span>
                <span className="block text-xs text-slate-500">{option.note}</span>
                <span className="mt-1 block text-sm font-semibold break-words text-navy-900 tabular-nums" aria-live="polite">
                  {option.price}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      ) : null}
      <TextField label={side === "buy" ? `You pay (${currency})` : `You receive (${currency})`} name="fiat" inputMode="decimal" placeholder="50,000" required state={state} />
      {unavailable ? <p className="text-sm text-slate-600">{desk} has no price for {asset} right now. Try again shortly.</p> : null}
      <Submit pending={pending || unavailable} className="w-full">
        <Zap className="size-4" aria-hidden="true" /> {source === "reserve" ? (side === "buy" ? `Buy from ${desk}` : `Sell to ${desk}`) : side === "buy" ? "Find the best price to buy" : "Find the best price to sell"}
      </Submit>
      <p className="text-xs text-slate-500">
        {source === "reserve"
          ? `Next you see ${desk}'s held price and exactly what you get before you confirm.`
          : "You see the price, BitoCard's fee and exactly what you get before you confirm. Trades settle instantly from your BitoCard wallets."}
      </p>
    </form>
  );
}

/** Sandbox stores only: test crypto to try the market. */
export function TestCryptoForm({ assets }: { assets: string[] }) {
  const [state, action, pending] = useActionState<FormState, FormData>(addTestCrypto, {});
  return (
    <form action={action} className="space-y-3" aria-label="Add test crypto">
      <FormMessage state={state} />
      <div className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-3">
        <AssetSelect assets={assets} />
        <TextField label="Amount" name="amount" inputMode="decimal" defaultValue="100" required state={state} />
      </div>
      <Submit pending={pending} className="w-full sm:w-auto">
        <Plus className="size-4" aria-hidden="true" /> Add test crypto
      </Submit>
    </form>
  );
}

/** Taking one ad from the market list: an amount in the customer's currency, then the confirmation. */
export function TakeAdForm({ adId, price, currency, side, min, max }: { adId: string; price: number; currency: string; side: "buy" | "sell"; min: string; max: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(takeAd, {});
  return (
    <form action={action} className="flex flex-col gap-2 sm:flex-row sm:items-end" aria-label={side === "buy" ? "Buy from this ad" : "Sell to this ad"}>
      <input type="hidden" name="ad_id" value={adId} />
      <input type="hidden" name="price" value={price} />
      <div className="min-w-0 flex-1">
        <TextField label={`Amount (${currency})`} name="fiat" inputMode="decimal" placeholder={`${min} – ${max}`} required state={state} />
      </div>
      <Submit pending={pending} className={side === "buy" ? "bg-emerald-600 hover:bg-emerald-700" : ""}>
        {side === "buy" ? "Buy" : "Sell"}
      </Submit>
      {state.error ? <p className="text-sm text-red-700" role="alert">{state.error}</p> : null}
    </form>
  );
}

/** The final step: confirms exactly the trade shown. */
export function ConfirmTradeForm({ adId, price, feeBps, fiat, label, nonce }: { adId: string; price: number; feeBps: number; fiat: number; label: string; nonce: string }) {
  const [state, action, pending] = useActionState<NonceFormState, FormData>(confirmTrade, {});
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
        <a href="/account/wallet" className="inline-flex min-h-11 items-center font-semibold text-brand-500 hover:underline">
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
  const [state, action, pending] = useActionState<FormState, FormData>(postAd, {});
  return (
    <form action={action} className="space-y-4" aria-label="Post an ad">
      <input type="hidden" name="side" value={side} />
      <input type="hidden" name="asset" value={asset} />
      <input type="hidden" name="currency" value={currency} />
      {market ? <input type="hidden" name="market" value={market} /> : null}
      <FormMessage state={state} />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label={`Your price per ${asset} (${currency})`} name="price" inputMode="decimal" defaultValue={suggestedPrice} placeholder="Enter a price" required state={state} hint={suggestedPrice ? "Filled from the current market price and desk markup. You can edit it." : "Enter the price you want to offer."} />
        <TextField label={`How much (${asset})`} name="amount" inputMode="decimal" defaultValue={suggestedAmount} placeholder="Amount" required state={state} hint={side === "sell" ? "Locked from your coin wallet while the ad is open." : `Calculated from your ${currency} balance at the suggested price; the final amount is locked when you post.`} />
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Min per trade" name="min_fiat" inputMode="decimal" placeholder="Minimum" required state={state} />
          <TextField label="Max per trade" name="max_fiat" inputMode="decimal" defaultValue={suggestedMax} placeholder="Maximum" required state={state} />
        </div>
      </div>
      <TextField label="Terms (optional)" name="terms" maxLength={500} placeholder="Anything buyers should know" state={state} />
      <Submit pending={pending} className="w-full sm:w-auto">
        <Plus className="size-4" aria-hidden="true" /> Post ad
      </Submit>
    </form>
  );
}

export function RepriceForm({ id, currency, price }: { id: string; currency: string; price: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(repriceAd, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-2" aria-label="Change price">
      <input type="hidden" name="id" value={id} />
      <div className="w-40">
        <TextField label={`New price (${currency})`} name="price" inputMode="decimal" defaultValue={price} required state={state} />
      </div>
      <button type="submit" disabled={pending} className="min-h-12 rounded-xl px-4 font-semibold ring-1 ring-slate-300 hover:ring-slate-400 disabled:opacity-60">
        Save
      </button>
      {state.error || state.notice ? <p className={`basis-full text-sm ${state.error ? "text-red-700" : "text-emerald-700"}`}>{state.error ?? state.notice}</p> : null}
    </form>
  );
}

export function NicknameForm({ current }: { current: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(chooseNickname, {});
  return (
    <form action={action} className="space-y-3" aria-label="Choose your nickname">
      <FormMessage state={state} />
      <TextField label="Nickname" name="nickname" defaultValue={current} pattern="[A-Za-z0-9_]{3,20}" maxLength={20} required state={state} hint="What other traders see instead of your name. 3 to 20 letters, numbers or underscores; you can choose it once." />
      <Submit pending={pending}>Save nickname</Submit>
    </form>
  );
}

/** Saves an address to withdraw to on a network: usable 24 hours after it is added. */
export function AddWithdrawalAddressForm({ chain, network }: { chain: string; network: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(addWithdrawalAddress, {});
  return (
    <form action={action} className="space-y-3" aria-label="Add an address">
      <input type="hidden" name="chain" value={chain} />
      <FormMessage state={state} />
      <TextField label={`${network} address`} name="address" autoComplete="off" spellCheck={false} required state={state} />
      <TextField label="Name" name="label" maxLength={40} placeholder="My wallet" required state={state} hint="New addresses can be used 24 hours after you add them. We email you each time one is added." />
      <Submit pending={pending} className="w-full sm:w-auto">
        <Plus className="size-4" aria-hidden="true" /> Save address
      </Submit>
    </form>
  );
}

/** Where and how much to send: the next step shows the fee and total before anything moves. */
export function WithdrawForm({ asset, chain, addresses, minimum }: { asset: string; chain: string; addresses: Array<{ id: string; label: string; address: string }>; minimum: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(reviewWithdrawal, {});
  return (
    <form action={action} className="space-y-4" aria-label={`Send ${asset}`}>
      <input type="hidden" name="asset" value={asset} />
      <input type="hidden" name="chain" value={chain} />
      <FormMessage state={state} />
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-semibold text-navy-900">Send to</legend>
        {addresses.map((item, index) => (
          <label key={item.id} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl px-3 py-2 ring-1 ring-slate-200 has-[:checked]:bg-pink-50 has-[:checked]:ring-2 has-[:checked]:ring-brand-500">
            <input type="radio" name="address_id" value={item.id} defaultChecked={index === 0} className="accent-brand-500" />
            <span className="min-w-0">
              <span className="block font-semibold">{item.label}</span>
              <span className="block truncate font-mono text-xs text-slate-500">{item.address}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <TextField label={`Amount (${asset})`} name="amount" inputMode="decimal" required state={state} hint={`At least ${minimum} ${asset}. BitoCard's network fee is added on top.`} />
      <Submit pending={pending} className="w-full">
        <Send className="size-4" aria-hidden="true" /> Review withdrawal
      </Submit>
    </form>
  );
}

/** Asks for the withdrawal the customer reviewed: the code to confirm it is emailed next. */
export function CreateWithdrawalForm({ asset, chain, addressId, amount, nonce }: { asset: string; chain: string; addressId: string; amount: string; nonce: string }) {
  const [state, action, pending] = useActionState<NonceFormState, FormData>(createWithdrawal, {});
  return (
    <form action={action} className="space-y-3">
      {/* Sent as the Idempotency-Key, so a double tap asks once. */}
      <input type="hidden" name="nonce" value={state.nonce ?? nonce} />
      <input type="hidden" name="asset" value={asset} />
      <input type="hidden" name="chain" value={chain} />
      <input type="hidden" name="address_id" value={addressId} />
      <input type="hidden" name="amount" value={amount} />
      <FormMessage state={state} />
      <Submit pending={pending} className="w-full">
        <Mail className="size-4" aria-hidden="true" /> Email me the code to send it
      </Submit>
    </form>
  );
}

/** The 6-digit code from the email, which confirms the withdrawal; or a new code. */
export function WithdrawalCodeForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(confirmWithdrawal, {});
  const [resent, resend, resending] = useActionState<FormState, FormData>(resendWithdrawalCode, {});
  return (
    <div className="space-y-3">
      <form action={action} className="space-y-3" aria-label="Confirm the withdrawal">
        <input type="hidden" name="id" value={id} />
        <FormMessage state={state} />
        <TextField label="Code from your email" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required state={state} />
        <Submit pending={pending} className="w-full">
          <Check className="size-4" aria-hidden="true" /> Confirm and send
        </Submit>
      </form>
      <form action={resend}>
        <input type="hidden" name="id" value={id} />
        <FormMessage state={resent} />
        <button type="submit" disabled={resending} className="inline-flex min-h-11 items-center font-semibold text-brand-500 hover:underline disabled:opacity-60">
          Send a new code
        </button>
      </form>
    </div>
  );
}

const fieldClass = "min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-navy-900 focus:border-brand-500 focus:ring-2 focus:ring-pink-100 focus:outline-none";

/** Adds a bank account for P2P money: the bank names its holder, who must be the customer. */
export function CashOutAccountForm({ banks }: { banks: Array<{ code: string; name: string }> }) {
  const [state, action, pending] = useActionState<FormState, FormData>(addCashOutAccount, {});
  return (
    <form action={action} className="space-y-3" aria-label="Add a bank account">
      <FormMessage state={state} />
      <label className="block space-y-1.5">
        <span className="block text-sm font-semibold text-navy-900">Bank</span>
        <select name="bank_code" required defaultValue="" className={fieldClass} aria-invalid={state.field === "bank_code" || undefined}>
          <option value="" disabled>
            Choose your bank
          </option>
          {banks.map(bank => (
            <option key={bank.code} value={bank.code}>
              {bank.name}
            </option>
          ))}
        </select>
      </label>
      <TextField label="Account number" name="account_number" inputMode="numeric" autoComplete="off" required state={state} hint="It must be in your own name, as your identity check shows it." />
      <Submit pending={pending} className="w-full sm:w-auto">
        <Plus className="size-4" aria-hidden="true" /> Add bank account
      </Submit>
    </form>
  );
}

/** Pays P2P money out to one of the customer's bank accounts. */
export function CashOutForm({ accounts, currency, available, nonce }: { accounts: Array<{ id: string; label: string; ready: boolean; from: string }>; currency: string; available: string; nonce: string }) {
  const [state, action, pending] = useActionState<NonceFormState, FormData>(cashOut, {});
  const usable = accounts.filter(item => item.ready);
  return (
    <form action={action} className="space-y-4" aria-label="Cash out">
      {/* Sent as the Idempotency-Key, so a double tap pays out once. */}
      <input type="hidden" name="nonce" value={state.nonce ?? nonce} />
      <FormMessage state={state} />
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-semibold text-navy-900">Pay into</legend>
        {accounts.map(item => (
          <label key={item.id} className={`flex min-h-12 items-center gap-3 rounded-xl px-3 py-2 ring-1 ring-slate-200 has-[:checked]:bg-pink-50 has-[:checked]:ring-2 has-[:checked]:ring-brand-500 ${item.ready ? "cursor-pointer" : "opacity-60"}`}>
            <input type="radio" name="bank_account_id" value={item.id} disabled={!item.ready} defaultChecked={item.id === usable[0]?.id} className="accent-brand-500" />
            <span className="min-w-0">
              <span className="block font-semibold">{item.label}</span>
              {!item.ready ? <span className="block text-xs text-amber-700">Usable from {item.from}</span> : null}
            </span>
          </label>
        ))}
      </fieldset>
      <TextField label={`Amount (${currency})`} name="amount" inputMode="decimal" required state={state} hint={`You can pay out ${available} now.`} />
      <Submit pending={pending} className="w-full">
        <Send className="size-4" aria-hidden="true" /> Pay out to my bank
      </Submit>
    </form>
  );
}
