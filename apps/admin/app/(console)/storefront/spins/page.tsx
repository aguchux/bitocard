"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { ArrowRightLeft, DollarSign, Gift, Users } from "lucide-react";
import { Card, CardHeader, DataTable, errorMessage, FilterSelect, formatDateTime, formatMoney, Notice, PageHeader, Select, StatCard, Toggle, type Column } from "@bitocard/admin-ui";
import { AdminShell, AppLink, can, useAdmin } from "@bitocard/admin-ui/shell";
import { type Mode, type SpinReward, useCountriesQuery, useSetSwitchMutation, useSpinRewardsQuery, useSwitchesQuery, useUpdateCountryMutation } from "@bitocard/api-client/admin";

const dollars = (value: string) => `$${Number(value).toFixed(2)}`;

const columns: Array<Column<SpinReward>> = [
  {
    key: "customer",
    header: "Customer",
    cell: spin => (
      <AppLink href={`/storefront/customers/${spin.customer.id}`} className="text-brand-600 hover:underline">
        {spin.customer.email}
      </AppLink>
    ),
  },
  {
    key: "won",
    header: "Won",
    cell: spin => <span className="font-semibold text-ink">{dollars(spin.usd)}</span>,
  },
  { key: "number", header: "Spin", cell: spin => `#${spin.number}` },
  { key: "date", header: "Date", hideOnMobile: true, cell: spin => formatDateTime(spin.created_at) },
];

/** Storefront > Spin and win: every customer's one-time $1, won spin by spin in US dollars and moved into their store wallet. */
export default function SpinRewardsPage() {
  // useSearchParams needs a Suspense boundary (a customer's page links here with ?customer=<id>).
  return (
    <Suspense>
      <SpinRewards />
    </Suspense>
  );
}

function SpinRewards() {
  const admin = useAdmin();
  const customer = useSearchParams().get("customer") ?? undefined;
  const [mode, setMode] = useState<Mode>("live");
  const spins = useSpinRewardsQuery({ mode, ...(customer ? { customer_id: customer } : {}) });
  const countries = useCountriesQuery();
  const switches = useSwitchesQuery();
  const [setSwitch, switchState] = useSetSwitchMutation();
  const [updateCountry, countryState] = useUpdateCountryMutation();
  const editable = can(admin, "operations");
  const switchValue = (country?: string) => switches.data?.data.find(row => row.key === "spin_rewards" && (country ? row.country_code === country : row.scope === "global"))?.enabled;
  const spinDefault = switches.data?.definitions.spin_rewards?.default ?? false;
  const usdTotal = Number(spins.data?.totals.usd ?? 0);
  const spinCount = spins.data?.totals.spins ?? 0;
  return (
    <AdminShell section="storefront" current="/storefront/spins" crumbs={[{ label: "Storefront", href: "/storefront" }, { label: "Spin and win" }]}>
      <PageHeader
        title="Spin and win"
        description="Run Spin and win and Customer Catcher from one place: availability, visitor spins, registered daily limits, claims and promotion spend."
      />
      <Card className="mt-6">
        <CardHeader title="Customer Catcher settings" description="The public /spin page is BitoCard-only. Each visitor gets a server-owned claim in an HttpOnly cookie; account eligibility is checked again before wallet credit." />
        {(switchState.error || countryState.error) ? <div className="px-5 pb-3 sm:px-6"><Notice tone="red">{errorMessage(switchState.error ?? countryState.error)}</Notice></div> : null}
        <div className="border-t border-line px-5 py-4 sm:px-6">
          <div className="flex min-h-12 items-center justify-between gap-4">
            <div><p className="font-semibold text-ink">Spin and win globally</p><p className="text-xs text-muted">Country overrides below still win.</p></div>
            <Toggle label="Spin and win globally" checked={switchValue() ?? spinDefault} disabled={!editable} onChange={enabled => setSwitch({ key: "spin_rewards", enabled })} />
          </div>
        </div>
        <ul className="divide-y divide-line border-t border-line">
          {countries.data?.data.map(country => {
            const countrySwitch = switchValue(country.code);
            const enabled = countrySwitch ?? switchValue() ?? spinDefault;
            return (
              <li key={country.code} className="grid gap-4 px-5 py-4 sm:grid-cols-[minmax(10rem,1fr)_auto_auto_auto] sm:items-end sm:px-6">
                <div><p className="font-semibold text-ink">{country.name}</p><p className="text-xs text-muted">{countrySwitch === undefined ? "Uses global promotion switch" : "Country override set"}</p></div>
                <label className="text-xs font-semibold text-muted">Registered / day<Select className="mt-1 w-24" value={country.spin_daily_limit ?? 2} disabled={!editable} onChange={event => updateCountry({ code: country.code, spin_daily_limit: Number(event.target.value) })}>{Array.from({ length: 10 }, (_, i) => i + 1).map(value => <option key={value}>{value}</option>)}</Select></label>
                <label className="text-xs font-semibold text-muted">Visitor spins<Select className="mt-1 w-24" value={country.public_spin_limit ?? 6} disabled={!editable} onChange={event => updateCountry({ code: country.code, public_spin_limit: Number(event.target.value) })}>{Array.from({ length: 10 }, (_, i) => i + 1).map(value => <option key={value}>{value}</option>)}</Select></label>
                <div className="flex items-center gap-5 pb-2">
                  <Toggle label={`Promotion in ${country.name}`} checked={enabled} disabled={!editable} onChange={value => setSwitch({ key: "spin_rewards", country_code: country.code, enabled: value })} />
                  <Toggle label={`Public page in ${country.name}`} checked={country.public_spins_enabled ?? false} disabled={!editable} onChange={value => updateCountry({ code: country.code, public_spins_enabled: value })} />
                </div>
              </li>
            );
          })}
        </ul>
      </Card>
      <div className="mt-6 flex flex-wrap gap-3">
        <FilterSelect id="spins-mode" label="Mode" value={mode} onChange={value => setMode(value as Mode)} options={[{ value: "live", label: "Live" }, { value: "test", label: "Test" }]} />
        {customer ? (
          <AppLink href="/storefront/spins" className="self-end pb-2 text-sm text-brand-600 hover:underline">
            Show every customer
          </AppLink>
        ) : null}
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={<DollarSign />} label="Won" value={dollars(String(usdTotal))} loading={spins.isLoading} />
        <StatCard icon={<Gift />} tone="blue" label="Spins" value={spinCount.toLocaleString("en-GB")} loading={spins.isLoading} />
        <StatCard icon={<Users />} tone="green" label="Customers started" value={(spins.data?.customers ?? 0).toLocaleString("en-GB")} loading={spins.isLoading} />
        {(spins.data?.exchanged ?? []).map(item => (
          <StatCard
            key={`exchanged-${item.currency}`}
            icon={<ArrowRightLeft />}
            tone="pink"
            label={`Moved to ${item.currency} wallets`}
            value={formatMoney(item.amount, item.currency)}
            footer={
              <span className="text-xs text-muted">
                {dollars(item.usd)} of rewards · {item.exchanges.toLocaleString("en-GB")} {item.exchanges === 1 ? "exchange" : "exchanges"}
              </span>
            }
          />
        ))}
      </div>
      <Card className="mt-4">
        <DataTable columns={columns} rows={spins.data?.data} rowKey={spin => spin.id} loading={spins.isLoading} error={spins.error ? errorMessage(spins.error) : null} onRetry={spins.refetch} empty="No spins yet." />
      </Card>
    </AdminShell>
  );
}
