"use client";

import { type ChangeEvent, type ReactNode, useActionState, useEffect, useState } from "react";
import { formatFace } from "@bitocard/api-client/storefront";
import { ArrowDownLeft, ArrowUpRight, Plus, Zap } from "lucide-react";
import { initialSource, type ReservePrices } from "@/lib/exchange";
import { FormMessage, Submit, TextField } from "@/components/store/account-forms";
import type { FormState } from "@/lib/account-actions";
import {
  addCashOutAccount,
  addTestCrypto,
  addWithdrawalAddress,
  bestP2pPrice,
  cancelWithdrawal,
  cashOut,
  confirmWithdrawal,
  createWithdrawal,
  findBestPrice,
  removeCashOutAccount,
  removeWithdrawalAddress,
  resendWithdrawalCode,
  reviewWithdrawal,
  simulateCashOut,
} from "@/lib/crypto-actions";
import { CashOutAccountForm as SharedCashOutAccountForm, type MoneyActions, MoneyActionsProvider } from "@bitocard/crypto-ui/money-forms";

// The trading forms are shared with BitoCard Crypto; each app gives them its own actions (`CryptoActionsProvider`).
export { ConfirmTradeForm, NicknameForm, PostAdForm, RepriceForm, TakeAdForm } from "@bitocard/crypto-ui/forms";
export { ActionButton, CopyButton } from "@bitocard/crypto-ui/money-forms";

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

/** Withdrawals and cashing out: the shared forms (`@bitocard/crypto-ui`) act through the store's own server actions. */
const storeMoney: MoneyActions = {
  addWithdrawalAddress,
  removeWithdrawalAddress,
  reviewWithdrawal,
  createWithdrawal,
  confirmWithdrawal,
  resendWithdrawalCode,
  cancelWithdrawal,
  addCashOutAccount,
  removeCashOutAccount,
  cashOut,
  simulateCashOut,
};

/** Gives the money forms below the store's actions (the Crypto tab's layout). */
export function StoreMoneyProvider({ children }: { children: ReactNode }) {
  return <MoneyActionsProvider actions={storeMoney}>{children}</MoneyActionsProvider>;
}

/** Adding a payout bank account outside the Crypto tab (the Shop tab's Safe pay page), with the store's actions. */
export function CashOutAccountForm({ banks }: { banks: Array<{ code: string; name: string }> }) {
  return (
    <StoreMoneyProvider>
      <SharedCashOutAccountForm banks={banks} />
    </StoreMoneyProvider>
  );
}
