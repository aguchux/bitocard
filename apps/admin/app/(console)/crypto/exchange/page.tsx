"use client";

import { useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import { Badge, Button, Card, CardHeader, DataTable, errorMessage, FilterSelect, formatDateTime, formatMoney, Input, Notice, PageHeader, Tabs, Toggle, type Column } from "@bitocard/admin-ui";
import { AdminShell, AppLink, can, useAdmin } from "@bitocard/admin-ui/shell";
import {
  type AdminExchangeTrade,
  type ExchangeMarkup,
  type ExchangeReserves,
  type Mode,
  type ReserveMovement,
  useExchangeMarkupsQuery,
  useExchangeReservesQuery,
  useExchangeTradesQuery,
  useReserveMovementsQuery,
  useSetExchangeMarkupMutation,
} from "@bitocard/api-client/admin";
import { ReserveMovementDialog } from "@/components/reserve-movement";

type Tab = "reserves" | "markups" | "trades";

/** A crypto amount without trailing zeros. */
const coins = (amount: string) => (amount.includes(".") ? amount.replace(/\.?0+$/, "") || "0" : amount);
const usd = (value: string | null) => (value === null ? "—" : `$${Number(value).toLocaleString("en-GB", { maximumFractionDigits: Number(value) >= 1 ? 2 : 6 })}`);
const percent = (bps: number) => `${(bps / 100).toLocaleString("en-GB", { maximumFractionDigits: 2 })}%`;

/**
 * Crypto > Exchange: BitoCard's reserves behind the instant exchange (finance funds and draws them down, each with an
 * emailed code), its markups on the live market price per coin and currency, and every trade with BitoCard's margin.
 */
export default function ExchangePage() {
  const admin = useAdmin();
  const [tab, setTab] = useState<Tab>("reserves");
  const [mode, setMode] = useState<Mode>("live");
  return (
    <AdminShell section="crypto" current="/crypto/exchange" crumbs={[{ label: "Crypto", href: "/crypto" }, { label: "Exchange" }]}>
      <PageHeader
        title="Exchange"
        description="Customers buy coins with their money wallet and sell coins for P2P money, straight from BitoCard's reserves. Every coin is priced from its live US dollar market price at the mid exchange rate; BitoCard adds only its markup. Trades never go beyond what a reserve holds."
      />
      <div className="mt-6 flex flex-wrap items-end justify-between gap-3">
        <Tabs
          label="Exchange"
          value={tab}
          onChange={setTab}
          items={[
            { value: "reserves", label: "Reserves" },
            { value: "markups", label: "Markups" },
            { value: "trades", label: "Trades" },
          ]}
        />
        <FilterSelect id="exchange-mode" label="Mode" value={mode} onChange={value => setMode(value as Mode)} options={[{ value: "live", label: "Live" }, { value: "test", label: "Sandbox" }]} />
      </div>
      <div className="mt-4">
        {tab === "reserves" ? <Reserves mode={mode} finance={can(admin, "finance")} /> : null}
        {tab === "markups" ? <Markups mode={mode} editable={can(admin, "operations", "finance")} /> : null}
        {tab === "trades" ? <Trades mode={mode} /> : null}
      </div>
    </AdminShell>
  );
}

const movementColumns: Array<Column<ReserveMovement>> = [
  { key: "number", header: "Movement", cell: row => <span className="font-semibold text-ink">{row.number}</span> },
  { key: "what", header: "What", cell: row => `${row.kind === "fund" ? "Funded" : "Drew down"} ${coins(row.amount)} ${row.currency}${row.country ? ` (${row.country})` : ""}` },
  {
    key: "status",
    header: "Status",
    cell: row => <Badge tone={row.status === "completed" ? "green" : row.status === "awaiting_code" ? "amber" : "grey"}>{{ completed: "Done", awaiting_code: "Waiting for code", expired: "Code expired", cancelled: "Cancelled" }[row.status]}</Badge>,
  },
  { key: "by", header: "By", hideOnMobile: true, cell: row => row.requested_by.name ?? "Admin" },
  { key: "when", header: "When", hideOnMobile: true, cell: row => formatDateTime(row.completed_at ?? row.created_at) },
];

function Reserves({ mode, finance }: { mode: Mode; finance: boolean }) {
  const reserves = useExchangeReservesQuery(mode);
  const movements = useReserveMovementsQuery({ mode });
  const [dialog, setDialog] = useState<"fund" | "withdraw" | null>(null);
  const [done, setDone] = useState<ReserveMovement | null>(null);
  const data = reserves.data;

  const coinColumns: Array<Column<ExchangeReserves["coins"][number]>> = [
    { key: "asset", header: "Coin", cell: row => <span className="font-semibold text-ink">{row.asset}</span> },
    { key: "balance", header: "In reserve", align: "right", cell: row => <span className="font-semibold tabular-nums">{coins(row.balance)}</span> },
    { key: "market", header: "Market price", align: "right", cell: row => (row.market ? usd(row.market.usd) : <span className="text-muted">No live price</span>) },
    { key: "change", header: "24h", align: "right", hideOnMobile: true, cell: row => (row.market?.change_24h === null || !row.market ? "—" : `${row.market.change_24h >= 0 ? "+" : ""}${row.market.change_24h}%`) },
  ];
  const moneyColumns: Array<Column<ExchangeReserves["markets"][number]>> = [
    { key: "market", header: "Market", cell: row => `${row.name} (${row.country})` },
    { key: "balance", header: "In reserve", align: "right", cell: row => <span className="font-semibold tabular-nums">{formatMoney(row.balance, row.currency)}</span> },
  ];

  return (
    <div className="space-y-4">
      {done ? <Notice tone="green">{`${done.number}: ${done.kind === "fund" ? "funded" : "drew down"} ${coins(done.amount)} ${done.currency}.`}</Notice> : null}
      {finance && data ? (
        <div className="flex flex-wrap gap-2">
          <Button icon={<ArrowDownToLine className="size-4" aria-hidden />} onClick={() => setDialog("fund")}>
            Fund a reserve
          </Button>
          <Button variant="secondary" icon={<ArrowUpFromLine className="size-4" aria-hidden />} onClick={() => setDialog("withdraw")}>
            Draw down
          </Button>
        </div>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Coin reserves" description="Shared by every market: what customers buy from, and where the coins they sell go." />
          <DataTable columns={coinColumns} rows={data?.coins} rowKey={row => row.asset} loading={reserves.isLoading} error={reserves.error ? errorMessage(reserves.error) : null} onRetry={reserves.refetch} empty="No coins." />
        </Card>
        <Card>
          <CardHeader title="Money reserves" description="One per market: what BitoCard pays customers who sell, and where buyers' money goes." />
          <DataTable columns={moneyColumns} rows={data?.markets} rowKey={row => `${row.country}:${row.currency}`} loading={reserves.isLoading} error={reserves.error ? errorMessage(reserves.error) : null} onRetry={reserves.refetch} empty="No markets." />
        </Card>
      </div>
      <Card>
        <CardHeader title="Latest movements" description="Every funding and draw-down, confirmed by the code emailed to the admin who asked." />
        <DataTable columns={movementColumns} rows={movements.data?.data} rowKey={row => row.id} loading={movements.isLoading} error={movements.error ? errorMessage(movements.error) : null} onRetry={movements.refetch} empty="No movements yet." />
      </Card>
      {dialog && data ? <ReserveMovementDialog open kind={dialog} mode={mode} reserves={data} onClose={() => setDialog(null)} onDone={setDone} /> : null}
    </div>
  );
}

function Markups({ mode, editable }: { mode: Mode; editable: boolean }) {
  const markups = useExchangeMarkupsQuery(mode);
  return (
    <Card>
      <CardHeader title="Markups" description="BitoCard's markup on the live market price, per coin and currency. Customers buy at the market price plus the buy markup and sell at it less the sell markup. At most 20%." />
      {markups.error && !markups.data ? <div className="px-5 pb-5"><Notice tone="red">{errorMessage(markups.error)}</Notice></div> : null}
      <ul className="divide-y divide-line">
        {(markups.data?.data ?? []).map(row => (
          <MarkupRow key={`${row.asset}-${row.currency}`} row={row} mode={mode} editable={editable} />
        ))}
      </ul>
      {markups.isLoading ? <p className="px-5 pb-5 text-sm text-muted">Loading…</p> : null}
    </Card>
  );
}

/** One coin in one currency: the live prices it gives, and its markups and limits to edit. */
function MarkupRow({ row, mode, editable }: { row: ExchangeMarkup; mode: Mode; editable: boolean }) {
  const [buy, setBuy] = useState(String(row.buy_markup_bps / 100));
  const [sell, setSell] = useState(String(row.sell_markup_bps / 100));
  const [min, setMin] = useState(String(row.min_fiat / 100));
  const [max, setMax] = useState(row.max_fiat === null ? "" : String(row.max_fiat / 100));
  const [save, state] = useSetExchangeMarkupMutation();
  const bps = (text: string) => Math.round(Number(text) * 100);
  const valid = [buy, sell].every(text => /^\d+(\.\d{1,2})?$/.test(text) && bps(text) <= 2000) && /^\d+(\.\d{1,2})?$/.test(min) && (max === "" || /^\d+(\.\d{1,2})?$/.test(max));
  const input = (enabled: boolean) => ({
    mode,
    asset: row.asset,
    currency: row.currency,
    buy_markup_bps: bps(buy),
    sell_markup_bps: bps(sell),
    min_fiat: Math.round(Number(min) * 100),
    max_fiat: max === "" ? null : Math.round(Number(max) * 100),
    enabled,
  });
  const id = `${row.asset}-${row.currency}`;
  return (
    <li className="space-y-3 px-5 py-4 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-ink">
            {row.asset} in {row.currency}
          </p>
          <p className="text-sm text-muted">
            Market {usd(row.market_usd)}
            {row.market_price !== null ? ` · ${formatMoney(row.market_price, row.currency)}` : " · no live price"}
            {row.buy_price !== null && row.sell_price !== null ? ` · customers buy at ${formatMoney(row.buy_price, row.currency)}, sell at ${formatMoney(row.sell_price, row.currency)}` : ""}
          </p>
        </div>
        <Toggle checked={row.enabled} label={`Offer ${row.asset} in ${row.currency}`} disabled={!editable || !valid || state.isLoading} onChange={enabled => void save(input(enabled))} />
      </div>
      {editable ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {[
            { label: "Buy markup %", value: buy, set: setBuy, key: "buy" },
            { label: "Sell markup %", value: sell, set: setSell, key: "sell" },
            { label: `Smallest (${row.currency})`, value: min, set: setMin, key: "min" },
            { label: `Largest (${row.currency})`, value: max, set: setMax, key: "max" },
          ].map(field => (
            <label key={field.key} htmlFor={`${id}-${field.key}`} className="flex flex-col gap-1 text-xs font-semibold text-muted">
              {field.label}
              <Input id={`${id}-${field.key}`} inputMode="decimal" value={field.value} placeholder={field.key === "max" ? "No limit" : undefined} onChange={event => field.set(event.target.value)} />
            </label>
          ))}
          <div className="flex items-end">
            <Button size="sm" className="w-full" loading={state.isLoading} disabled={!valid} onClick={() => void save(input(row.enabled))}>
              Save
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted">
          Buy {percent(row.buy_markup_bps)} · sell {percent(row.sell_markup_bps)}
        </p>
      )}
      {state.error ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
    </li>
  );
}

function Trades({ mode }: { mode: Mode }) {
  const trades = useExchangeTradesQuery({ mode });
  const columns: Array<Column<AdminExchangeTrade>> = [
    { key: "number", header: "Trade", cell: row => <span className="font-semibold text-ink">{row.number}</span> },
    {
      key: "customer",
      header: "Customer",
      cell: row =>
        row.customer ? (
          <AppLink href={`/crypto/customers/${row.customer.id}`} className="text-brand-600 hover:underline">
            {row.customer.email}
          </AppLink>
        ) : (
          "—"
        ),
    },
    { key: "what", header: "What", cell: row => `${row.side === "buy" ? "Bought" : "Sold"} ${coins(row.amount)} ${row.asset}` },
    { key: "money", header: "Money", align: "right", cell: row => formatMoney(row.fiat, row.currency) },
    { key: "market", header: "Market", align: "right", hideOnMobile: true, cell: row => usd(row.market_usd) },
    { key: "margin", header: "Margin", align: "right", cell: row => <span className="font-semibold text-emerald-700">{formatMoney(row.markup, row.currency)}</span> },
    { key: "when", header: "When", hideOnMobile: true, cell: row => formatDateTime(row.created_at) },
  ];
  return (
    <Card>
      <DataTable columns={columns} rows={trades.data?.data} rowKey={row => row.id} loading={trades.isLoading} error={trades.error ? errorMessage(trades.error) : null} onRetry={trades.refetch} empty="No exchange trades yet." />
    </Card>
  );
}
