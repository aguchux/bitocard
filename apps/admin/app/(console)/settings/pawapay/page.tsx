"use client";

import { useMemo, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Globe2, Plus, RefreshCw, Store } from "lucide-react";
import { Badge, Button, Card, Dialog, Field, Input, Notice, QueryView, Select, Skeleton, StatCard, errorMessage } from "@bitocard/admin-ui";
import { AdminShell, AppLink, can, useAdmin } from "@bitocard/admin-ui/shell";
import { type PawapayCountry, useCreateCountryMutation, usePawapayCoverageQuery, useSetPaymentMethodsMutation } from "@bitocard/api-client/admin";

type Filter = "all" | "markets" | "new";
const filters: Array<{ key: Filter; label: string }> = [
  { key: "all", label: "All countries" },
  { key: "markets", label: "BitoCard markets" },
  { key: "new", label: "Not a market yet" },
];

/** Open for something (`OPERATIONAL` or `DELAYED`), as opposed to closed or not on the account. */
const open = (status: string | null) => Boolean(status && status !== "CLOSED");
const takesDeposits = (country: PawapayCountry) => country.currencies.some(currency => currency.networks.some(network => open(network.deposits)));
const makesPayouts = (country: PawapayCountry) => country.currencies.some(currency => currency.networks.some(network => open(network.payouts)));

function StatusDot({ label, status }: { label: string; status: string | null }) {
  const tone = !status ? "grey" : status === "CLOSED" ? "red" : status === "OPERATIONAL" ? "green" : "amber";
  return (
    <Badge tone={tone} className="text-[11px]">
      {label}: {status ? status.charAt(0) + status.slice(1).toLowerCase() : "Not on account"}
    </Badge>
  );
}

/**
 * pawaPay coverage: every country, currency and mobile money network on BitoCard's pawaPay account, read live from
 * pawaPay, with whether each takes payments in (checkout and top-ups) and makes payouts (mobile money top-ups sold to
 * customers). Countries that are not BitoCard markets yet can be added from here.
 */
export default function PawapayCoveragePage() {
  const admin = useAdmin();
  const query = usePawapayCoverageQuery();
  const [filter, setFilter] = useState<Filter>("all");
  const [adding, setAdding] = useState<PawapayCountry | null>(null);
  const editable = can(admin, "operations");

  return (
    <AdminShell section="settings" current="/settings/pawapay" crumbs={[{ label: "Settings", href: "/settings" }, { label: "pawaPay coverage" }]}>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1 basis-80">
          <h1 className="text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">pawaPay coverage</h1>
          <p className="mt-1 text-base text-muted">
            Every country and mobile money network on BitoCard&apos;s pawaPay account, read live from pawaPay. Payments in are checkout and wallet top-ups; payouts are mobile money top-ups sold to customers. Countries are switched on in the pawaPay dashboard.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {query.data ? <Badge tone={query.data.environment === "live" ? "green" : "amber"}>{query.data.environment === "live" ? "Live account" : "Sandbox account"}</Badge> : null}
          <Button variant="secondary" size="sm" icon={<RefreshCw className="size-4" aria-hidden="true" />} loading={query.isFetching} onClick={() => void query.refetch()}>
            Refresh
          </Button>
        </div>
      </div>

      <div className="mt-6">
        <QueryView query={query} loading={<Skeleton className="h-64" />}>
          {coverage => <Coverage countries={coverage.data} filter={filter} setFilter={setFilter} editable={editable} onAdd={setAdding} />}
        </QueryView>
      </div>
      {adding ? <AddMarketDialog country={adding} onClose={() => setAdding(null)} /> : null}
    </AdminShell>
  );
}

function Coverage({ countries, filter, setFilter, editable, onAdd }: { countries: PawapayCountry[]; filter: Filter; setFilter: (filter: Filter) => void; editable: boolean; onAdd: (country: PawapayCountry) => void }) {
  const shown = countries.filter(country => filter === "all" || (filter === "markets" ? country.market : !country.market));
  const counts = useMemo(
    () => ({ countries: countries.length, markets: countries.filter(country => country.market).length, deposits: countries.filter(takesDeposits).length, payouts: countries.filter(makesPayouts).length }),
    [countries],
  );
  if (!countries.length) return <Notice tone="amber" title="No countries on the account">pawaPay has no countries switched on for this account yet. Switch them on in the pawaPay dashboard.</Notice>;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Countries" value={counts.countries} icon={<Globe2 />} tone="blue" />
        <StatCard label="BitoCard markets" value={counts.markets} icon={<Store />} tone="green" />
        <StatCard label="Taking payments in" value={counts.deposits} icon={<ArrowDownLeft />} tone="pink" />
        <StatCard label="Making payouts" value={counts.payouts} icon={<ArrowUpRight />} tone="amber" />
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Show">
        {filters.map(item => (
          <button
            key={item.key}
            type="button"
            aria-pressed={filter === item.key}
            onClick={() => setFilter(item.key)}
            className="min-h-10 rounded-full border border-line px-4 text-sm font-semibold text-ink aria-pressed:border-brand-500 aria-pressed:bg-brand-50"
          >
            {item.label}
          </button>
        ))}
      </div>

      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {shown.map(country => (
          <li key={country.code}>
            <Card className="flex h-full flex-col gap-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-bold text-ink">{country.name}</p>
                  <p className="text-sm text-muted">
                    {country.code} · {country.currencies.map(currency => currency.currency).join(", ")}
                  </p>
                </div>
                {/* eslint-disable-next-line @next/next/no-img-element -- tiny static SVGs served by this app */}
                <img src={`/flags/${country.code.toLowerCase()}.svg`} alt="" width={36} height={24} className="h-6 w-9 shrink-0 rounded-[3px] object-cover shadow-[0_0_0_1px_rgba(7,15,76,.12)]" />
              </div>
              {country.currencies.map(currency => (
                <div key={currency.currency} className="space-y-2">
                  {country.currencies.length > 1 ? <p className="text-xs font-semibold tracking-wide text-muted uppercase">{currency.currency}</p> : null}
                  <ul className="space-y-2">
                    {currency.networks.map(network => (
                      <li key={network.id} className="rounded-lg bg-canvas px-3 py-2">
                        <p className="text-sm font-semibold text-ink">{network.name}</p>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          <StatusDot label="In" status={network.deposits} />
                          <StatusDot label="Out" status={network.payouts} />
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
                {country.market ? (
                  <>
                    <span className="text-sm text-muted">
                      Market in {country.market.currency} · pawaPay {country.market.checkout || country.market.wallet_top_up ? `on for ${[country.market.checkout ? "checkout" : null, country.market.wallet_top_up ? "top-ups" : null].filter(Boolean).join(" and ")}` : "off"}
                    </span>
                    <AppLink href={`/settings/markets?country=${country.code}`} className="text-sm font-semibold text-brand-600 hover:underline">
                      Open market
                    </AppLink>
                  </>
                ) : (
                  <>
                    <Badge tone="grey">Not a market yet</Badge>
                    {editable ? (
                      <Button size="sm" icon={<Plus className="size-4" aria-hidden="true" />} onClick={() => onAdd(country)}>
                        Add as market
                      </Button>
                    ) : null}
                  </>
                )}
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Adds a pawaPay country as a BitoCard market: its name, currency (pawaPay's, the local one first) and minimum
 * withdrawal, and optionally pawaPay switched on for customer checkout and wallet top-ups there. Every product
 * category starts off except software; operations switch them on in Markets.
 */
function AddMarketDialog({ country, onClose }: { country: PawapayCountry; onClose: () => void }) {
  const currencies = [...country.currencies.map(item => item.currency)].sort((a, b) => Number(a === "USD") - Number(b === "USD"));
  const [name, setName] = useState(country.name);
  const [currency, setCurrency] = useState(currencies[0] ?? "");
  const [minimum, setMinimum] = useState("10");
  const deposits = country.currencies.find(item => item.currency === currency)?.networks.some(network => open(network.deposits)) ?? false;
  const [payments, setPayments] = useState(true);
  const [create, created] = useCreateCountryMutation();
  const [setMethods, methods] = useSetPaymentMethodsMutation();
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    const units = Number(minimum);
    if (!Number.isFinite(units) || units < 0) return setError("Enter the minimum withdrawal as a number.");
    try {
      await create({ code: country.code, name: name.trim(), currency, min_withdrawal_minor: Math.round(units * 100) }).unwrap();
      if (payments && deposits) {
        await setMethods({ code: country.code, purpose: "checkout", enabled: ["pawapay"] }).unwrap();
        await setMethods({ code: country.code, purpose: "wallet_top_up", enabled: ["pawapay"] }).unwrap();
      }
      onClose();
    } catch (failure) {
      setError(errorMessage(failure));
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Add ${country.name} as a market`}
      description="Every product category starts off except software; switch them on in Markets once suppliers, tax and terms are ready."
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={created.isLoading || methods.isLoading} onClick={() => void submit()}>
            Add market
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {error ? <Notice tone="red">{error}</Notice> : null}
        <Field label="Name" htmlFor="market-name">
          <Input id="market-name" value={name} onChange={event => setName(event.target.value)} maxLength={80} />
        </Field>
        <Field label="Currency" htmlFor="market-currency" hint="Resellers and customers there trade in it. It cannot be changed later.">
          <Select id="market-currency" value={currency} onChange={event => setCurrency(event.target.value)}>
            {currencies.map(item => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={`Minimum withdrawal (${currency})`} htmlFor="market-minimum" hint="The smallest payout a reseller there can ask for.">
          <Input id="market-minimum" inputMode="decimal" value={minimum} onChange={event => setMinimum(event.target.value)} />
        </Field>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" className="mt-0.5 size-4" checked={payments && deposits} disabled={!deposits} onChange={event => setPayments(event.target.checked)} />
          <span>
            <span className="block font-semibold text-ink">Switch on pawaPay for customer checkout and wallet top-ups</span>
            <span className="block text-muted">{deposits ? "Mobile money payments in, from the networks above." : `pawaPay takes no payments in ${currency} here yet.`}</span>
          </span>
        </label>
      </div>
    </Dialog>
  );
}
