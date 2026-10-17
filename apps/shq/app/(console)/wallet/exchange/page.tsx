"use client";

import { useId, useState } from "react";
import { Button, Card, CardHeader, errorMessage, Field, formatMoney, Input, Notice, PageHeader, Select } from "@bitocard/admin-ui";
import { type ExchangeMarkup, useResellerExchangeDeskQuery, useResellerExchangeMarkupsQuery, useResellerExchangeReservesQuery, useSetResellerExchangeDeskMutation, useSetResellerExchangeMarkupMutation, useTransferExchangeCoinsMutation, useTransferExchangeReserveMutation } from "@bitocard/api-client/reseller";
import { ShqShell } from "@/components/shq-shell";
import { can, useReseller } from "@/components/reseller";
import { TradePanel } from "./trade-panel";

const amountMinor = (value: string) => {
  const match = /^(\d{1,12})(?:\.(\d{0,2}))?$/.exec(value.replace(/,/g, ""));
  return match ? Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0")) : null;
};
const percentBps = (value: string) => /^\d+(?:\.\d{1,2})?$/.test(value) ? Math.round(Number(value) * 100) : null;
const coinAmount = (value: string) => value.replace(/\.?0+$/, "") || "0";

/** Reserve funding comes from topped-up money; coin reserves grow when the reseller buys coins from BitoCard. */
function ReserveTransfer({ currencies }: { currencies: string[] }) {
  const id = useId();
  const [currency, setCurrency] = useState(currencies[0] ?? "USD");
  const [direction, setDirection] = useState<"fund" | "withdraw">("fund");
  const [value, setValue] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [transfer, state] = useTransferExchangeReserveMutation();
  const amount = amountMinor(value);
  return (
    <Card className="p-5 sm:p-6">
      <h2 className="text-lg font-bold text-ink">Move wallet money into your reserve</h2>
      <p className="mt-1 text-sm text-muted">Your customers can sell coins only while this reserve can pay them. Money moved here cannot pay for orders until you draw it down.</p>
      <form className="mt-5 grid gap-4 sm:grid-cols-3" onSubmit={event => {
        event.preventDefault();
        if (!amount || !Number.isSafeInteger(amount)) return;
        setMessage(null);
        void transfer({ currency, amount, direction }).unwrap().then(() => { setValue(""); setMessage(direction === "fund" ? "Reserve funded." : "Money returned to your wallet."); }).catch(() => undefined);
      }}>
        <Field label="Action" htmlFor={`${id}-direction`}>
          <Select id={`${id}-direction`} value={direction} onChange={event => setDirection(event.target.value as "fund" | "withdraw")}>
            <option value="fund">Fund reserve</option>
            <option value="withdraw">Draw down</option>
          </Select>
        </Field>
        <Field label="Wallet" htmlFor={`${id}-currency`}>
          <Select id={`${id}-currency`} value={currency} onChange={event => setCurrency(event.target.value)}>
            {currencies.map(code => <option key={code} value={code}>{code}</option>)}
          </Select>
        </Field>
        <Field label={`Amount (${currency})`} htmlFor={`${id}-amount`}>
          <Input id={`${id}-amount`} inputMode="decimal" value={value} onChange={event => setValue(event.target.value)} placeholder="0.00" />
        </Field>
        <div className="sm:col-span-3 flex flex-wrap items-center gap-3">
          <Button type="submit" loading={state.isLoading} disabled={!amount || !Number.isSafeInteger(amount)}>{direction === "fund" ? "Fund reserve" : "Draw down"}</Button>
          {message ? <span className="text-sm font-semibold text-mint-700" role="status">{message}</span> : null}
        </div>
      </form>
      {state.error ? <div className="mt-4"><Notice tone="red">{errorMessage(state.error)}</Notice></div> : null}
    </Card>
  );
}

function CoinTransfer({ coins }: { coins: Array<{ asset: string; name: string; balance: string }> }) {
  const id = useId();
  const [asset, setAsset] = useState(coins[0]?.asset ?? "BTC");
  const [direction, setDirection] = useState<"fund" | "withdraw">("fund");
  const [amount, setAmount] = useState("");
  const [done, setDone] = useState(false);
  const [transfer, state] = useTransferExchangeCoinsMutation();
  return <Card className="p-5 sm:p-6">
    <h2 className="text-lg font-bold text-ink">Move coins into your reserve</h2>
    <p className="mt-1 text-sm text-muted">Coins bought from BitoCard enter your coin wallet. Move them here to let customers buy them, or draw them down to sell back to BitoCard.</p>
    <form className="mt-5 grid gap-4 sm:grid-cols-3" onSubmit={event => {
      event.preventDefault(); if (!/^\d+(?:\.\d{1,8})?$/.test(amount) || Number(amount) <= 0) return;
      setDone(false); void transfer({ asset, amount, direction }).unwrap().then(() => { setAmount(""); setDone(true); }).catch(() => undefined);
    }}>
      <Field label="Action" htmlFor={`${id}-direction`}><Select id={`${id}-direction`} value={direction} onChange={event => setDirection(event.target.value as "fund" | "withdraw")}><option value="fund">Fund reserve</option><option value="withdraw">Draw down</option></Select></Field>
      <Field label="Coin" htmlFor={`${id}-asset`}><Select id={`${id}-asset`} value={asset} onChange={event => setAsset(event.target.value)}>{coins.map(coin => <option key={coin.asset} value={coin.asset}>{coin.name} ({coin.asset})</option>)}</Select></Field>
      <Field label={`Amount (${asset})`} htmlFor={`${id}-amount`}><Input id={`${id}-amount`} inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} placeholder="0.00" /></Field>
      <div className="sm:col-span-3 flex items-center gap-3"><Button type="submit" loading={state.isLoading} disabled={!amount}>{direction === "fund" ? "Fund coin reserve" : "Draw down coins"}</Button>{done ? <span role="status" className="text-sm text-mint-700">Transfer complete.</span> : null}</div>
    </form>
    {state.error ? <div className="mt-4"><Notice tone="red">{errorMessage(state.error)}</Notice></div> : null}
  </Card>;
}

function MarkupRow({ row, mode }: { row: ExchangeMarkup; mode: "test" | "live" }) {
  const id = useId();
  const [buy, setBuy] = useState(String(row.buy_markup_bps / 100));
  const [sell, setSell] = useState(String(row.sell_markup_bps / 100));
  const [minimum, setMinimum] = useState(String(row.min_fiat / 100));
  const [maximum, setMaximum] = useState(row.max_fiat === null ? "" : String(row.max_fiat / 100));
  const [enabled, setEnabled] = useState(row.enabled);
  const [saved, setSaved] = useState(false);
  const [save, state] = useSetResellerExchangeMarkupMutation();
  const buyBps = percentBps(buy);
  const sellBps = percentBps(sell);
  const min = amountMinor(minimum);
  const max = maximum.trim() ? amountMinor(maximum) : null;
  const valid = buyBps !== null && sellBps !== null && buyBps <= 2000 && sellBps <= 2000 && min !== null && (max === null || max >= min);
  return (
    <li className="space-y-3 border-t border-line px-5 py-4 first:border-t-0 sm:px-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold text-ink">{row.asset} · {row.currency}</h3>
          <p className="text-sm text-muted">Market {row.market_usd ? `$${row.market_usd}` : "price unavailable"}{row.buy_price !== null ? ` · customers buy at ${formatMoney(row.buy_price, row.currency)}` : ""}</p>
        </div>
        <label className="flex min-h-11 items-center gap-2 text-sm font-semibold text-ink"><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} className="size-5 accent-brand-500" /> Offer</label>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Buy markup %" htmlFor={`${id}-buy`}><Input id={`${id}-buy`} inputMode="decimal" value={buy} onChange={event => setBuy(event.target.value)} /></Field>
        <Field label="Sell markup %" htmlFor={`${id}-sell`}><Input id={`${id}-sell`} inputMode="decimal" value={sell} onChange={event => setSell(event.target.value)} /></Field>
        <Field label={`Minimum ${row.currency}`} htmlFor={`${id}-min`}><Input id={`${id}-min`} inputMode="decimal" value={minimum} onChange={event => setMinimum(event.target.value)} /></Field>
        <Field label={`Maximum ${row.currency}`} htmlFor={`${id}-max`}><Input id={`${id}-max`} inputMode="decimal" value={maximum} onChange={event => setMaximum(event.target.value)} placeholder="No limit" /></Field>
      </div>
      <div className="flex items-center gap-3">
        <Button size="sm" disabled={!valid} loading={state.isLoading} onClick={() => {
          setSaved(false);
          void save({ mode, asset: row.asset, currency: row.currency, enabled, buy_markup_bps: buyBps!, sell_markup_bps: sellBps!, min_fiat: min!, max_fiat: max }).unwrap().then(() => setSaved(true)).catch(() => undefined);
        }}>Save price</Button>
        {saved ? <span className="text-sm text-mint-700" role="status">Saved</span> : null}
      </div>
      {state.error ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
    </li>
  );
}

export default function ExchangePage() {
  const { membership, mode } = useReseller();
  const allowed = can(membership, "admin", "finance");
  const reserves = useResellerExchangeReservesQuery(undefined, { skip: !allowed });
  const markups = useResellerExchangeMarkupsQuery(undefined, { skip: !allowed });
  const desk = useResellerExchangeDeskQuery(undefined, { skip: !allowed });
  const [setDesk, deskChange] = useSetResellerExchangeDeskMutation();
  const wallets = reserves.data?.wallets ?? [];
  return (
    <ShqShell section="wallet" current="/wallet/exchange" crumbs={[{ label: "Wallet", href: "/wallet" }, { label: "Exchange" }]}>
      <PageHeader title="Exchange" description="Keep money and coins in your own reserve for customers buying or selling on your store. BitoCard controls when exchange is available in your market." />
      {!allowed ? <Notice tone="amber">Only your store&apos;s owner, admin or finance team can manage exchange reserves and prices.</Notice> : null}
      {allowed ? <div className="mt-6 space-y-6">
        <TradePanel currencies={wallets.map(wallet => wallet.currency).length ? wallets.map(wallet => wallet.currency) : ["USD"]} />
        {reserves.error ? <Notice tone="red">{errorMessage(reserves.error)}</Notice> : null}
        {reserves.data ? <>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card><CardHeader title="Coin reserve" description="What your customers can buy from your store." />
              <ul className="divide-y divide-line px-5 pb-4 sm:px-6">{reserves.data.coins.map(coin => <li key={coin.asset} className="flex justify-between gap-3 py-3 text-sm"><span className="font-semibold text-ink">{coin.name} ({coin.asset})</span><span className="tabular-nums">{coinAmount(coin.balance)} {coin.asset}</span></li>)}</ul>
            </Card>
            <Card><CardHeader title="Money reserve" description="What your store can pay customers who sell coins." />
              <ul className="divide-y divide-line px-5 pb-4 sm:px-6">{wallets.map(wallet => <li key={wallet.currency} className="flex justify-between gap-3 py-3 text-sm"><span className="font-semibold text-ink">{wallet.currency}</span><span className="tabular-nums">{formatMoney(wallet.balance, wallet.currency)}</span></li>)}</ul>
            </Card>
          </div>
          <ReserveTransfer currencies={wallets.map(wallet => wallet.currency)} />
          <CoinTransfer coins={reserves.data.coins} />
        </> : null}
        {desk.data ? <Card className="p-5 sm:p-6">
          <h2 className="text-lg font-bold text-ink">Your customer exchange desk</h2>
          <p className="mt-1 text-sm text-muted">{desk.data.enabled ? "BitoCard has enabled your desk for this market." : "Your desk is awaiting BitoCard approval for this market."} Customers can trade with your desk only while its price is enabled and its reserve is funded.</p>
          <label className="mt-4 flex min-h-11 items-center gap-3 text-sm font-semibold text-ink">
            <input type="checkbox" className="size-5 accent-brand-500" checked={desk.data.fallback_to_bitocard} disabled={deskChange.isLoading} onChange={event => { void setDesk({ fallback_to_bitocard: event.target.checked }); }} />
            Let customers use BitoCard when my desk does not offer a coin
          </label>
          {deskChange.error ? <div className="mt-3"><Notice tone="red">{errorMessage(deskChange.error)}</Notice></div> : null}
        </Card> : null}
        <Card><CardHeader title="Customer prices" description="Choose a markup and trade limits per coin and currency. An offer can execute only while your matching reserve holds enough." />
          {markups.error ? <div className="px-5 pb-5"><Notice tone="red">{errorMessage(markups.error)}</Notice></div> : null}
          <ul>{markups.data?.data.map(row => <MarkupRow key={`${mode}-${row.asset}-${row.currency}`} row={row} mode={mode} />)}</ul>
        </Card>
      </div> : null}
    </ShqShell>
  );
}
