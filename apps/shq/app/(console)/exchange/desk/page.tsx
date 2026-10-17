"use client";

import { useId, useState } from "react";
import { Button, Card, CardHeader, errorMessage, Field, formatMoney, Input, Notice, PageHeader, QueryView, Select, Skeleton, StatusBadge, Toggle } from "@bitocard/admin-ui";
import {
  type ExchangeMarkup,
  type ExchangeReserves,
  useResellerExchangeDeskQuery,
  useResellerExchangeMarkupsQuery,
  useResellerExchangeReservesQuery,
  useSetResellerExchangeDeskMutation,
  useSetResellerExchangeMarkupMutation,
  useTransferExchangeCoinsMutation,
  useTransferExchangeReserveMutation,
} from "@bitocard/api-client/reseller";
import { ShqShell } from "@/components/shq-shell";
import { can, useReseller } from "@/components/reseller";
import { amountMinor, coinAmount, deskBlock, exchangeRoles, percentBps, validCoin } from "../shared";

type Direction = "fund" | "withdraw";

/** Topped-up money behind customers selling coins; a draw-down comes back as topped-up funds. */
function MoneyTransfer({ currencies }: { currencies: string[] }) {
  const id = useId();
  const [currency, setCurrency] = useState(currencies[0] ?? "USD");
  const [direction, setDirection] = useState<Direction>("fund");
  const [value, setValue] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [transfer, state] = useTransferExchangeReserveMutation();
  const amount = amountMinor(value);
  const valid = amount !== null && amount > 0 && Number.isSafeInteger(amount);
  return (
    <Card className="p-5 sm:p-6">
      <h2 className="text-lg font-bold text-ink">Move money</h2>
      <p className="mt-1 text-sm text-muted">Fund your money reserve from your wallet, or draw it down. Money in the reserve cannot pay for orders; drawn down, it comes back to your wallet as topped-up funds.</p>
      <form
        className="mt-5 grid gap-4 sm:grid-cols-3"
        onSubmit={event => {
          event.preventDefault();
          if (!valid) return;
          setMessage(null);
          void transfer({ currency, amount, direction })
            .unwrap()
            .then(() => {
              setValue("");
              setMessage(direction === "fund" ? "Reserve funded." : "Money returned to your wallet.");
            })
            .catch(() => undefined);
        }}
      >
        <Field label="Action" htmlFor={`${id}-direction`}>
          <Select id={`${id}-direction`} value={direction} onChange={event => setDirection(event.target.value as Direction)}>
            <option value="fund">Fund reserve</option>
            <option value="withdraw">Draw down</option>
          </Select>
        </Field>
        <Field label="Wallet" htmlFor={`${id}-currency`}>
          <Select id={`${id}-currency`} value={currency} onChange={event => setCurrency(event.target.value)}>
            {currencies.map(code => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={`Amount (${currency})`} htmlFor={`${id}-amount`}>
          <Input id={`${id}-amount`} inputMode="decimal" value={value} onChange={event => setValue(event.target.value)} placeholder="0.00" />
        </Field>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-3">
          <Button type="submit" loading={state.isLoading} disabled={!valid}>
            {direction === "fund" ? "Fund reserve" : "Draw down"}
          </Button>
          {message ? (
            <span className="text-sm font-semibold text-mint-700" role="status">
              {message}
            </span>
          ) : null}
        </div>
      </form>
      {state.error ? (
        <div className="mt-4">
          <Notice tone="red">{errorMessage(state.error)}</Notice>
        </div>
      ) : null}
    </Card>
  );
}

/** Coins between the reseller's coin wallet and the reserve its customers buy from. */
function CoinTransfer({ coins }: { coins: ExchangeReserves["coins"] }) {
  const id = useId();
  const [asset, setAsset] = useState(coins[0]?.asset ?? "BTC");
  const [direction, setDirection] = useState<Direction>("fund");
  const [amount, setAmount] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [transfer, state] = useTransferExchangeCoinsMutation();
  return (
    <Card className="p-5 sm:p-6">
      <h2 className="text-lg font-bold text-ink">Move coins</h2>
      <p className="mt-1 text-sm text-muted">Coins you buy from BitoCard go to your coin wallet. Move them into your reserve so customers can buy them, or draw them down to sell back to BitoCard.</p>
      <form
        className="mt-5 grid gap-4 sm:grid-cols-3"
        onSubmit={event => {
          event.preventDefault();
          if (!validCoin(amount)) return;
          setMessage(null);
          void transfer({ asset, amount, direction })
            .unwrap()
            .then(result => {
              setAmount("");
              setMessage(`Done. Coin wallet ${coinAmount(result.wallet)} ${result.asset}, reserve ${coinAmount(result.reserve)} ${result.asset}.`);
            })
            .catch(() => undefined);
        }}
      >
        <Field label="Action" htmlFor={`${id}-direction`}>
          <Select id={`${id}-direction`} value={direction} onChange={event => setDirection(event.target.value as Direction)}>
            <option value="fund">Fund reserve</option>
            <option value="withdraw">Draw down</option>
          </Select>
        </Field>
        <Field label="Coin" htmlFor={`${id}-asset`}>
          <Select id={`${id}-asset`} value={asset} onChange={event => setAsset(event.target.value)}>
            {coins.map(coin => (
              <option key={coin.asset} value={coin.asset}>
                {coin.name} ({coin.asset})
              </option>
            ))}
          </Select>
        </Field>
        <Field label={`Amount (${asset})`} htmlFor={`${id}-amount`}>
          <Input id={`${id}-amount`} inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} placeholder="0.00" />
        </Field>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-3">
          <Button type="submit" loading={state.isLoading} disabled={!validCoin(amount)}>
            {direction === "fund" ? "Fund coin reserve" : "Draw down coins"}
          </Button>
          {message ? (
            <span role="status" className="text-sm font-semibold text-mint-700">
              {message}
            </span>
          ) : null}
        </div>
      </form>
      {state.error ? (
        <div className="mt-4">
          <Notice tone="red">{errorMessage(state.error)}</Notice>
        </div>
      ) : null}
    </Card>
  );
}

const percent = (bps: number) => `${bps / 100}%`;
const priceOrDash = (minor: number | null, currency: string) => (minor === null ? "—" : formatMoney(minor, currency));

/** One coin and currency: the market price beside the reseller's markups and limits. */
function MarkupRow({ row, mode, editable, capBps }: { row: ExchangeMarkup; mode: "test" | "live"; editable: boolean; capBps: number }) {
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
  const valid = buyBps !== null && sellBps !== null && buyBps <= capBps && sellBps <= capBps && min !== null && (!maximum.trim() || (max !== null && max >= min));
  const market = (
    <p className="text-sm text-muted">
      Market {priceOrDash(row.market_price, row.currency)}
      {row.market_usd && row.currency !== "USD" ? ` ($${row.market_usd})` : ""} · customers buy at {priceOrDash(row.buy_price, row.currency)}, sell at {priceOrDash(row.sell_price, row.currency)}
    </p>
  );
  if (!editable) {
    return (
      <li className="space-y-1 border-t border-line px-5 py-4 first:border-t-0 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold text-ink">
            {row.asset} · {row.currency}
          </h3>
          <StatusBadge status={row.enabled ? "enabled" : "disabled"} label={row.enabled ? "Offered" : "Not offered"} />
        </div>
        {market}
        <p className="text-sm text-ink">
          Buy markup {percent(row.buy_markup_bps)} · Sell markup {percent(row.sell_markup_bps)} · Trades from {formatMoney(row.min_fiat, row.currency)}
          {row.max_fiat === null ? "" : ` to ${formatMoney(row.max_fiat, row.currency)}`}
        </p>
      </li>
    );
  }
  return (
    <li className="space-y-3 border-t border-line px-5 py-4 first:border-t-0 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold text-ink">
            {row.asset} · {row.currency}
          </h3>
          {market}
        </div>
        <label className="flex min-h-11 items-center gap-2 text-sm font-semibold text-ink">
          <input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} className="size-5 accent-brand-500" /> Offer to customers
        </label>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="Buy markup %" htmlFor={`${id}-buy`}>
          <Input id={`${id}-buy`} inputMode="decimal" value={buy} onChange={event => setBuy(event.target.value)} />
        </Field>
        <Field label="Sell markup %" htmlFor={`${id}-sell`}>
          <Input id={`${id}-sell`} inputMode="decimal" value={sell} onChange={event => setSell(event.target.value)} />
        </Field>
        <Field label={`Smallest trade (${row.currency})`} htmlFor={`${id}-min`}>
          <Input id={`${id}-min`} inputMode="decimal" value={minimum} onChange={event => setMinimum(event.target.value)} />
        </Field>
        <Field label={`Largest trade (${row.currency})`} htmlFor={`${id}-max`}>
          <Input id={`${id}-max`} inputMode="decimal" value={maximum} onChange={event => setMaximum(event.target.value)} placeholder="No limit" />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          disabled={!valid}
          loading={state.isLoading}
          onClick={() => {
            if (!valid) return;
            setSaved(false);
            void save({ mode, asset: row.asset, currency: row.currency, enabled, buy_markup_bps: buyBps, sell_markup_bps: sellBps, min_fiat: min, max_fiat: max })
              .unwrap()
              .then(() => setSaved(true))
              .catch(() => undefined);
          }}
        >
          Save price
        </Button>
        {saved ? (
          <span className="text-sm font-semibold text-mint-700" role="status">
            Saved
          </span>
        ) : null}
        {!valid ? <span className="text-sm text-muted">Markups are at most {capBps / 100}% in your market, and the largest trade must be at least the smallest.</span> : null}
      </div>
      {state.error ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
    </li>
  );
}

function Reserves({ reserves, editable }: { reserves: ExchangeReserves; editable: boolean }) {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Coin reserve" description="What your customers can buy from you." />
          <ul className="divide-y divide-line px-5 pb-4 sm:px-6">
            {reserves.coins.map(coin => (
              <li key={coin.asset} className="flex flex-wrap justify-between gap-x-3 gap-y-1 py-3 text-sm">
                <span className="font-semibold text-ink">
                  {coin.name} ({coin.asset})
                </span>
                <span className="tabular-nums">
                  {coinAmount(coin.balance)} {coin.asset}
                </span>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Money reserve" description="What you can pay customers who sell you coins." />
          <ul className="divide-y divide-line px-5 pb-4 sm:px-6">
            {reserves.wallets.map(wallet => (
              <li key={wallet.currency} className="flex justify-between gap-3 py-3 text-sm">
                <span className="font-semibold text-ink">{wallet.currency}</span>
                <span className="tabular-nums">{formatMoney(wallet.balance, wallet.currency)}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      {editable ? (
        <>
          <MoneyTransfer currencies={reserves.wallets.map(wallet => wallet.currency)} />
          <CoinTransfer coins={reserves.coins} />
        </>
      ) : null}
    </div>
  );
}

/** The reseller's own customer exchange desk: whether BitoCard switched it on, the fallback, reserves and prices. */
export default function ExchangeDeskPage() {
  const { membership, mode } = useReseller();
  const manager = can(membership, ...exchangeRoles);
  const desk = useResellerExchangeDeskQuery();
  const reserves = useResellerExchangeReservesQuery();
  const markups = useResellerExchangeMarkupsQuery();
  const [setDesk, deskChange] = useSetResellerExchangeDeskMutation();
  const block = deskBlock(desk.data, mode, membership);
  const editable = manager && Boolean(desk.data) && !block;
  return (
    <ShqShell section="exchange" current="/exchange/desk" crumbs={[{ label: "Exchange", href: "/exchange" }, { label: "Your desk" }]}>
      <PageHeader title="Your desk" description="Sell coins to your own customers and buy from them at your prices, from reserves you fund. Your customers can trade with your desk only while a price is offered and its reserve holds enough." />
      <div className="mt-6 space-y-6">
        <QueryView query={desk} loading={<Skeleton className="h-40 w-full" />}>
          {data => (
            <Card className="p-5 sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-bold text-ink">Desk status</h2>
                <StatusBadge status={data.enabled ? "enabled" : "disabled"} label={data.enabled ? "On" : "Off"} />
              </div>
              {block ? (
                <div className="mt-4">
                  <Notice tone="amber" title={block.title}>
                    {block.body}
                  </Notice>
                </div>
              ) : (
                <p className="mt-1 text-sm text-muted">BitoCard has switched your desk on.</p>
              )}
              {!manager ? (
                <div className="mt-4">
                  <Notice tone="blue">Only your business&apos;s owner, admins and finance team can change the desk, its reserves and prices.</Notice>
                </div>
              ) : null}
              <div className="mt-5 flex items-start justify-between gap-4 border-t border-line pt-5">
                <div className="min-w-0">
                  <p className="font-semibold text-ink">Fall back to BitoCard</p>
                  <p className="text-sm text-muted">When your desk does not offer a coin, let your customers trade it with BitoCard instead.</p>
                </div>
                <Toggle
                  label="Fall back to BitoCard"
                  checked={data.fallback_to_bitocard}
                  disabled={!manager || !data.enabled || deskChange.isLoading}
                  onChange={checked => void setDesk({ fallback_to_bitocard: checked })}
                />
              </div>
              {deskChange.error ? (
                <div className="mt-3">
                  <Notice tone="red">{errorMessage(deskChange.error)}</Notice>
                </div>
              ) : null}
            </Card>
          )}
        </QueryView>

        <section aria-labelledby="desk-reserves" className="space-y-4">
          <h2 id="desk-reserves" className="text-xl font-bold text-ink">
            Reserves
          </h2>
          <QueryView query={reserves} loading={<Skeleton className="h-48 w-full" />}>
            {data => <Reserves reserves={data} editable={editable} />}
          </QueryView>
        </section>

        <Card>
          <CardHeader title="Customer prices" description="A markup over the market price and trade limits for each coin and currency. Your market sets the highest markup allowed." />
          <div className="mt-4">
            <QueryView query={markups} loading={<Skeleton className="m-5 h-40" />}>
              {data =>
                data.data.length ? (
                  <ul>
                    {data.data.map(row => (
                      <MarkupRow key={`${mode}-${row.asset}-${row.currency}-${editable}`} row={row} mode={mode} editable={editable} capBps={desk.data?.markup_cap_bps ?? 2000} />
                    ))}
                  </ul>
                ) : (
                  <p className="px-5 pb-5 text-sm text-muted sm:px-6">No coins are offered yet.</p>
                )
              }
            </QueryView>
          </div>
        </Card>
      </div>
    </ShqShell>
  );
}
