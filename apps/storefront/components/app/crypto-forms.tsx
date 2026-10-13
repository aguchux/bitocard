"use client";

import { type ReactNode, useActionState, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Check, Copy, Mail, Plus, Send, Zap } from "lucide-react";
import { FormMessage, Submit, TextField } from "@/components/store/account-forms";
import type { FormState } from "@/lib/account-actions";
import {
  addCashOutAccount,
  addTestCrypto,
  addWithdrawalAddress,
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

const selectClass = "min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-[#070f4c] focus:border-[#ff2382] focus:ring-2 focus:ring-pink-100 focus:outline-none";

/** Buy or sell, as a two-button switch that works as radios (so the form posts without script). */
function SideSwitch({ name = "side", value, onChange, labels = { buy: "Buy", sell: "Sell" } }: { name?: string; value: "buy" | "sell"; onChange: (side: "buy" | "sell") => void; labels?: { buy: string; sell: string } }) {
  return (
    <fieldset className="grid grid-cols-2 gap-1 rounded-2xl bg-slate-100 p-1">
      <legend className="sr-only">Buy or sell</legend>
      {(["buy", "sell"] as const).map(side => (
        <label
          key={side}
          className={`flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-xl text-sm font-bold has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[#ff2382] ${
            value === side ? (side === "buy" ? "bg-emerald-600 text-white shadow-sm" : "bg-[#ff2382] text-white shadow-sm") : "text-slate-600"
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

function AssetSelect({ assets, defaultValue, name = "asset", label = "Coin" }: { assets: string[]; defaultValue?: string; name?: string; label?: string }) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-sm font-semibold text-[#070f4c]">{label}</span>
      <select name={name} defaultValue={defaultValue ?? assets[0]} className={selectClass}>
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
      className="inline-flex min-h-11 items-center gap-2 rounded-xl px-4 font-semibold text-[#070f4c] ring-1 ring-slate-300 hover:ring-slate-400"
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

/** One tap to the best price: buy or sell, which coin and how much (in the customer's currency). */
export function QuickTrade({ assets, currency, defaultAsset, defaultSide = "buy" }: { assets: string[]; currency: string; defaultAsset?: string; defaultSide?: "buy" | "sell" }) {
  const [state, action, pending] = useActionState<FormState, FormData>(findBestPrice, {});
  const [side, setSide] = useState<"buy" | "sell">(defaultSide);
  return (
    <form action={action} className="space-y-4" aria-label="Quick trade">
      <SideSwitch value={side} onChange={setSide} />
      <FormMessage state={state} />
      <div className="grid gap-3 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)]">
        <AssetSelect assets={assets} defaultValue={defaultAsset} />
        <TextField label={side === "buy" ? `You pay (${currency})` : `You receive (${currency})`} name="fiat" inputMode="decimal" placeholder="50,000" required state={state} />
      </div>
      <Submit pending={pending} className="w-full">
        <Zap className="size-4" aria-hidden="true" /> {side === "buy" ? "Find the best price to buy" : "Find the best price to sell"}
      </Submit>
      <p className="text-xs text-slate-500">You see the price, BitoCard&apos;s fee and exactly what you get before you confirm. Trades settle instantly from your BitoCard wallets.</p>
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
        <a href="/account/wallet" className="inline-flex min-h-11 items-center font-semibold text-[#ff2382] hover:underline">
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
export function PostAdForm({ assets, currency }: { assets: string[]; currency: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(postAd, {});
  const [side, setSide] = useState<"buy" | "sell">("sell");
  return (
    <form action={action} className="space-y-4" aria-label="Post an ad">
      <SideSwitch value={side} onChange={setSide} labels={{ buy: "I want to buy", sell: "I want to sell" }} />
      <FormMessage state={state} />
      <div className="grid gap-3 sm:grid-cols-2">
        <AssetSelect assets={assets} />
        <TextField label={`Your price per coin (${currency})`} name="price" inputMode="decimal" placeholder="1,650" required state={state} />
        <TextField label="How much (coins)" name="amount" inputMode="decimal" placeholder="100" required state={state} hint={side === "sell" ? "Locked from your wallet while the ad is open." : "The money for it is locked from your balance while the ad is open."} />
        <div className="grid grid-cols-2 gap-3">
          <TextField label={`Min per trade`} name="min_fiat" inputMode="decimal" placeholder="1,000" required state={state} />
          <TextField label={`Max per trade`} name="max_fiat" inputMode="decimal" placeholder="500,000" required state={state} />
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
        <legend className="mb-1 text-sm font-semibold text-[#070f4c]">Send to</legend>
        {addresses.map((item, index) => (
          <label key={item.id} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl px-3 py-2 ring-1 ring-slate-200 has-[:checked]:bg-pink-50 has-[:checked]:ring-2 has-[:checked]:ring-[#ff2382]">
            <input type="radio" name="address_id" value={item.id} defaultChecked={index === 0} className="accent-[#ff2382]" />
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
        <button type="submit" disabled={resending} className="inline-flex min-h-11 items-center font-semibold text-[#ff2382] hover:underline disabled:opacity-60">
          Send a new code
        </button>
      </form>
    </div>
  );
}

const fieldClass = "min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-[#070f4c] focus:border-[#ff2382] focus:ring-2 focus:ring-pink-100 focus:outline-none";

/** Adds a bank account for P2P money: the bank names its holder, who must be the customer. */
export function CashOutAccountForm({ banks }: { banks: Array<{ code: string; name: string }> }) {
  const [state, action, pending] = useActionState<FormState, FormData>(addCashOutAccount, {});
  return (
    <form action={action} className="space-y-3" aria-label="Add a bank account">
      <FormMessage state={state} />
      <label className="block space-y-1.5">
        <span className="block text-sm font-semibold text-[#070f4c]">Bank</span>
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
        <legend className="mb-1 text-sm font-semibold text-[#070f4c]">Pay into</legend>
        {accounts.map(item => (
          <label key={item.id} className={`flex min-h-12 items-center gap-3 rounded-xl px-3 py-2 ring-1 ring-slate-200 has-[:checked]:bg-pink-50 has-[:checked]:ring-2 has-[:checked]:ring-[#ff2382] ${item.ready ? "cursor-pointer" : "opacity-60"}`}>
            <input type="radio" name="bank_account_id" value={item.id} disabled={!item.ready} defaultChecked={item.id === usable[0]?.id} className="accent-[#ff2382]" />
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