"use client";

import { useState } from "react";
import { amountToMinor, Button, Card, DataTable, Dialog, errorMessage, Field, formatMoney, Input, Notice, PageHeader, QueryView, Skeleton, Tabs, type Column } from "@bitocard/admin-ui";
import { can, useAdmin } from "@bitocard/admin-ui/shell";
import { type MarketLimit, type MarketLimitInput, useMarketLimitsQuery, useSetMarketLimitMutation } from "@bitocard/api-client/afrippa-admin";
import { AfrippaShell } from "@/components/shell";

type Mode = MarketLimit["mode"];
type Amount = Exclude<keyof MarketLimitInput, "mode" | "market" | "currency">;

const amounts: Array<{ key: Amount; label: string; hint?: string }> = [
  { key: "per_trade", label: "Per order" },
  { key: "per_day", label: "Per 24 hours" },
  { key: "cross_border_per_trade", label: "Per order, from another country", hint: "Traders from elsewhere in a country's book." },
  { key: "cross_border_per_day", label: "Per 24 hours, from another country" },
  { key: "new_trader_per_trade", label: "Per order, new traders", hint: "Fewer than 5 completed orders." },
  { key: "new_trader_per_day", label: "Per 24 hours, new traders" },
  { key: "merchant_per_trade", label: "Per order, merchants", hint: "Approved merchants, in their own market or the global one. Empty: the market's own." },
  { key: "merchant_per_day", label: "Per 24 hours, merchants" },
];

const shown = (value: number | null, currency: string) => (value === null ? "No limit" : formatMoney(value, currency));
const typed = (value: number | null) => (value === null ? "" : (value / 100).toFixed(2));

/** Setting one market's limits in one currency. An empty amount is no limit. */
function LimitDialog({ limit, mode, onClose }: { limit: MarketLimit | "new"; mode: Mode; onClose: () => void }) {
  const existing = limit === "new" ? null : limit;
  const [market, setMarket] = useState(existing?.market ?? "");
  const [currency, setCurrency] = useState(existing?.currency ?? "");
  const [values, setValues] = useState<Record<Amount, string>>(() => Object.fromEntries(amounts.map(({ key }) => [key, typed(existing?.[key] ?? null)])) as Record<Amount, string>);
  const [save, state] = useSetMarketLimitMutation();
  const parsed = Object.fromEntries(amounts.map(({ key }) => [key, values[key].trim() === "" ? null : amountToMinor(values[key])])) as Record<Amount, number | null>;
  const bad = amounts.filter(({ key }) => values[key].trim() !== "" && (parsed[key] === null || parsed[key] === 0));
  const codes = /^([A-Z]{2})$/.test(market.trim().toUpperCase()) && /^[A-Z]{3}$/.test(currency.trim().toUpperCase());
  return (
    <Dialog
      open
      onClose={onClose}
      title={existing ? `${existing.market} in ${existing.currency}` : "New market limits"}
      description={`${mode === "test" ? "Sandbox" : "Live"} limits. Start them low and raise them as the market proves itself. An empty amount is no limit.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!codes || bad.length > 0}
            loading={state.isLoading}
            onClick={async () => {
              const saved = await save({ mode, market: market.trim().toUpperCase(), currency: currency.trim().toUpperCase(), ...parsed })
                .unwrap()
                .catch(() => null);
              if (saved) onClose();
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {state.error ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
        {existing ? null : (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Market" htmlFor="limit-market" hint="A country code, or WW for the global market.">
              <Input id="limit-market" maxLength={2} value={market} onChange={event => setMarket(event.target.value)} />
            </Field>
            <Field label="Currency" htmlFor="limit-currency" hint="The global market trades in USD only.">
              <Input id="limit-currency" maxLength={3} value={currency} onChange={event => setCurrency(event.target.value)} />
            </Field>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          {amounts.map(({ key, label, hint }) => (
            <Field key={key} label={label} htmlFor={`limit-${key}`} hint={hint} error={bad.some(item => item.key === key) ? "Enter an amount above zero, with up to two decimals." : undefined}>
              <Input id={`limit-${key}`} inputMode="decimal" value={values[key]} onChange={event => setValues(current => ({ ...current, [key]: event.target.value }))} />
            </Field>
          ))}
        </div>
      </div>
    </Dialog>
  );
}

/**
 * Settings > Market limits: how much one trader may trade per order and per 24 hours in each market and currency,
 * tighter across borders and for new traders. Live trading in a market needs its limits. Finance or operations, after
 * step-up; audited.
 */
export default function MarketLimitsPage() {
  const admin = useAdmin();
  const [mode, setMode] = useState<Mode>("live");
  const query = useMarketLimitsQuery(mode);
  const [editing, setEditing] = useState<MarketLimit | "new" | null>(null);
  const edits = can(admin, "operations", "finance");

  const columns: Array<Column<MarketLimit>> = [
    { key: "market", header: "Market", cell: limit => <span className="font-semibold text-ink">{`${limit.market === "WW" ? "Global" : limit.market} · ${limit.currency}`}</span> },
    { key: "trade", header: "Per order", cell: limit => shown(limit.per_trade, limit.currency) },
    { key: "day", header: "Per 24 hours", cell: limit => shown(limit.per_day, limit.currency) },
    {
      key: "others",
      header: "Across borders · new traders · merchants",
      hideOnMobile: true,
      cell: limit => (
        <span className="text-sm text-muted">
          {shown(limit.cross_border_per_trade, limit.currency)} / {shown(limit.cross_border_per_day, limit.currency)} · {shown(limit.new_trader_per_trade, limit.currency)} / {shown(limit.new_trader_per_day, limit.currency)} ·{" "}
          {shown(limit.merchant_per_trade ?? null, limit.currency)} / {shown(limit.merchant_per_day ?? null, limit.currency)}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      cell: limit =>
        edits ? (
          <Button size="sm" variant="secondary" onClick={() => setEditing(limit)}>
            Change
          </Button>
        ) : null,
    },
  ];

  return (
    <AfrippaShell section="settings" current="/settings/limits" crumbs={[{ label: "Settings", href: "/settings" }, { label: "Market limits" }]}>
      <PageHeader
        title="Market limits"
        description="How much one trader may trade in each market, per order and per 24 hours. Live, a market without limits cannot trade."
        actions={edits ? <Button onClick={() => setEditing("new")}>New market</Button> : null}
      />
      <Tabs
        label="Mode"
        value={mode}
        onChange={setMode}
        items={[
          { value: "live", label: "Live" },
          { value: "test", label: "Sandbox" },
        ]}
      />
      <QueryView query={query} loading={<Skeleton className="h-64 w-full" />}>
        {data => (
          <Card>
            <DataTable<MarketLimit> caption="Market limits" rows={data.data} rowKey={limit => `${limit.market}:${limit.currency}`} empty="No markets have limits yet." columns={columns} />
          </Card>
        )}
      </QueryView>
      {editing ? <LimitDialog limit={editing} mode={mode} onClose={() => setEditing(null)} /> : null}
    </AfrippaShell>
  );
}
