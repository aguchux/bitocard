"use client";

import { useEffect, useId, useState } from "react";
import { Button, Card, CardHeader, errorMessage, Field, formatMoney, Input, Notice, Select } from "@bitocard/admin-ui";
import { type ResellerExchangeQuote, useQuoteResellerExchangeMutation, useResellerExchangeOverviewQuery, useResellerExchangeTradesQuery, useTradeResellerExchangeMutation } from "@bitocard/api-client/reseller";

const coinInput = /^\d{1,12}(?:\.\d{1,8})?$/;

export function TradePanel({ currencies }: { currencies: string[] }) {
  const id = useId();
  const [currency, setCurrency] = useState(currencies[0] ?? "USD");
  const [asset, setAsset] = useState("BTC");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<ResellerExchangeQuote | null>(null);
  const [expired, setExpired] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const overview = useResellerExchangeOverviewQuery(currency);
  const history = useResellerExchangeTradesQuery();
  const [makeQuote, quoting] = useQuoteResellerExchangeMutation();
  const [makeTrade, trading] = useTradeResellerExchangeMutation();
  const pair = overview.data?.assets.find(row => row.asset === asset);
  const open = pair && !("closed" in pair) ? pair : null;
  const reset = () => { setQuote(null); setDone(null); };
  useEffect(() => {
    if (!quote) return;
    const timer = window.setTimeout(() => setExpired(true), Math.max(0, Date.parse(quote.expires_at) - Date.now()));
    return () => window.clearTimeout(timer);
  }, [quote]);

  return <div className="space-y-6">
    <Card className="p-5 sm:p-6">
      <h2 className="text-lg font-bold text-ink">Trade with BitoCard</h2>
      <p className="mt-1 text-sm text-muted">Buy coins from BitoCard with your local or US dollar wallet, or sell coins back. Each trade is limited by BitoCard&apos;s reserve.</p>
      {overview.error ? <div className="mt-4"><Notice tone="amber">{errorMessage(overview.error)}</Notice></div> : null}
      {overview.data ? <>
        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          <Field label="Wallet" htmlFor={`${id}-currency`}><Select id={`${id}-currency`} value={currency} onChange={event => { setCurrency(event.target.value); reset(); }}>
            {currencies.map(code => <option key={code} value={code}>{code}</option>)}</Select></Field>
          <Field label="Coin" htmlFor={`${id}-asset`}><Select id={`${id}-asset`} value={asset} onChange={event => { setAsset(event.target.value); reset(); }}>
            {overview.data.assets.map(row => <option key={row.asset} value={row.asset}>{row.name} ({row.asset})</option>)}</Select></Field>
          <Field label="Action" htmlFor={`${id}-side`}><Select id={`${id}-side`} value={side} onChange={event => { setSide(event.target.value as "buy" | "sell"); reset(); }}>
            <option value="buy">Buy coin</option><option value="sell">Sell coin</option></Select></Field>
        </div>
        {open ? <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <div>BitoCard sells at <strong>{formatMoney(open.buy_price, currency)} / {asset}</strong></div>
          <div>BitoCard buys at <strong>{formatMoney(open.sell_price, currency)} / {asset}</strong></div>
          <div>Available to buy: <strong>{open.available_to_buy} {asset}</strong></div>
          <div>Available to sell for: <strong>{formatMoney(open.available_to_sell_for, currency)}</strong></div>
          <div>Your coin wallet: <strong>{open.your_coins} {asset}</strong></div>
          <div>Your fiat wallet: <strong>{formatMoney(open.your_wallet, currency)}</strong></div>
        </div> : <div className="mt-4"><Notice tone="amber">{pair && "closed" in pair ? `This pair is unavailable (${pair.closed}).` : "Choose an available coin."}</Notice></div>}
        <form className="mt-5 flex flex-wrap items-end gap-3" onSubmit={event => {
          event.preventDefault(); reset();
          if (!open || !coinInput.test(amount)) return;
          void makeQuote({ asset, currency, side, amount }).unwrap().then(result => { setExpired(false); setQuote(result); }).catch(() => undefined);
        }}>
          <Field label={`Amount (${asset})`} htmlFor={`${id}-amount`}><Input id={`${id}-amount`} inputMode="decimal" value={amount} onChange={event => { setAmount(event.target.value); reset(); }} placeholder="0.00" /></Field>
          <Button type="submit" disabled={!open || !coinInput.test(amount)} loading={quoting.isLoading}>Review trade</Button>
        </form>
        {quoting.error ? <div className="mt-3"><Notice tone="red">{errorMessage(quoting.error)}</Notice></div> : null}
        {quote ? <div className="mt-5 rounded-xl border border-line p-4" role="region" aria-label="Trade quote">
          <p className="font-semibold">{side === "buy" ? `Buy ${quote.amount} ${asset}` : `Sell ${quote.amount} ${asset}`} with BitoCard</p>
          <p className="mt-1 text-sm">{side === "buy" ? "You pay" : "You receive"} {formatMoney(quote.fiat, currency)} at {formatMoney(quote.price, currency)} per {asset}.</p>
          <p className="mt-1 text-sm text-muted">Includes a {quote.markup_bps / 100}% BitoCard markup. Price held until {new Date(quote.expires_at).toLocaleTimeString()}.</p>
          <Button className="mt-3" loading={trading.isLoading} disabled={expired} onClick={() => {
            void makeTrade({ quote_id: quote.id }).unwrap().then(result => { setDone(`${result.number}: ${result.side === "buy" ? "Bought" : "Sold"} ${result.amount} ${result.asset} for ${formatMoney(result.fiat, result.currency)}.`); setQuote(null); }).catch(() => undefined);
          }}>Confirm {side}</Button>
          {expired ? <p className="mt-2 text-sm text-muted">This quote expired. Review the trade again for a new price.</p> : null}
        </div> : null}
        {trading.error ? <div className="mt-3"><Notice tone="red">{errorMessage(trading.error)}</Notice></div> : null}
        {done ? <p className="mt-4 text-sm font-semibold text-mint-700" role="status">{done}</p> : null}
      </> : null}
    </Card>
    <Card><CardHeader title="Trades with BitoCard" description="Your completed wallet and coin exchanges." />
      {history.error ? <div className="px-5 pb-5"><Notice tone="red">{errorMessage(history.error)}</Notice></div> : null}
      <ul className="divide-y divide-line px-5 pb-4 sm:px-6">{history.data?.data.map(row => <li key={row.id} className="flex flex-wrap justify-between gap-2 py-3 text-sm">
        <span><strong>{row.number}</strong> · {row.side === "buy" ? "Bought" : "Sold"} {row.amount} {row.asset}</span><span>{formatMoney(row.fiat, row.currency)}</span>
      </li>)}</ul>
    </Card>
  </div>;
}
