"use client";

import { useId, useState, type FormEvent } from "react";
import { Button, Card, CardHeader, currencyDigits, errorMessage, Field, Input, Notice, PageHeader, QueryView, Skeleton, Toggle } from "@bitocard/admin-ui";
import { can, useAdmin } from "@bitocard/admin-ui/shell";
import { type ConnectSettings, type ConnectState, useConnectSettingsQuery, useConnectStatesQuery, useSetConnectSettingsMutation, useSetConnectStateMutation } from "@bitocard/api-client/admin";
import { MarketFilter } from "@/components/classifieds";
import { money, toMinor } from "@/components/connect";
import { UdozoShell } from "@/components/shell";

const toMajor = (minor: number | null, currency: string) => (minor === null ? "" : String(minor / 10 ** currencyDigits(currency)));

function DepositCard({ settings, changes }: { settings: ConnectSettings; changes: boolean }) {
  const id = useId();
  const [save, state] = useSetConnectSettingsMutation();
  const [value, setValue] = useState(toMajor(settings.deposit, settings.currency));
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setProblem(null);
    setSaved(false);
    const deposit = value.trim() === "" ? null : toMinor(value, settings.currency);
    if (value.trim() !== "" && deposit === null) return setProblem(`Give the deposit in ${settings.currency}, for example 50000.`);
    const done = await save({ country: settings.country, deposit }).unwrap().catch(() => null);
    if (done) setSaved(true);
  };

  return (
    <Card>
      <CardHeader title="Deposit" description="What each applicant pays from their UdozoPay wallet when they submit. It is held while they run a centre, and goes back if the application is rejected or withdrawn." />
      <div className="space-y-4 px-5 pb-5 sm:px-6">
        <p className="text-sm text-ink">
          Now: <span className="font-semibold">{settings.deposit === null ? "Not set" : money(settings.deposit, settings.currency)}</span>
        </p>
        {settings.deposit === null ? <Notice tone="amber">Applications in {settings.name} cannot be submitted until the deposit is set.</Notice> : null}
        {changes ? (
          <form onSubmit={submit} className="space-y-3">
            {problem ? <Notice tone="red">{problem}</Notice> : null}
            {state.error ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
            {saved ? <Notice tone="green">Saved. New applications pay this deposit.</Notice> : null}
            <Field label={`Deposit (${settings.currency})`} htmlFor={`${id}-deposit`} hint="Leave it empty to clear it: applications then cannot be submitted.">
              <Input id={`${id}-deposit`} inputMode="decimal" value={value} onChange={event => setValue(event.target.value)} className="max-w-xs" />
            </Field>
            <Button type="submit" loading={state.isLoading}>
              Save deposit
            </Button>
          </form>
        ) : (
          <p className="text-xs text-muted">Only finance can change the deposit.</p>
        )}
      </div>
    </Card>
  );
}

function StatesCard({ country, changes }: { country: string; changes: boolean }) {
  const states = useConnectStatesQuery(country);
  const [setState, state] = useSetConnectStateMutation();
  return (
    <Card>
      <CardHeader title="States" description="Every state is open for applications until it is switched off here. Centres already approved are not affected." />
      <div className="px-5 pb-5 sm:px-6">
        {state.error ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
        <QueryView query={states} loading={<Skeleton className="h-48 w-full" />}>
          {data =>
            data.data.length ? (
              <ul className="divide-y divide-line">
                {data.data.map((item: ConnectState) => (
                  <li key={item.id} className="flex min-w-0 items-center justify-between gap-3 py-2.5">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-ink">{item.name}</span>
                      <span className="block text-xs text-muted">{item.open ? "Open" : "Closed"}</span>
                    </span>
                    <Toggle checked={item.open} label={`Open in ${item.name}`} disabled={!changes} onChange={enabled => void setState({ id: item.id, country, enabled })} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">This market has no states yet.</p>
            )
          }
        </QueryView>
      </div>
    </Card>
  );
}

/**
 * Connect > States and deposit, per market: the deposit applicants pay when they submit (finance, inside the step-up
 * window) and the states that take applications (operations), each open unless switched off.
 */
export default function ConnectSettingsPage() {
  const admin = useAdmin();
  const [country, setCountry] = useState("NG");
  const settings = useConnectSettingsQuery(country);
  return (
    <UdozoShell section="connect" current="/connect/settings" crumbs={[{ label: "Connect", href: "/connect/applications" }, { label: "States and deposit" }]}>
      <PageHeader title="States and deposit" description="Applications open in a market with the connect_applications switch (Settings > Feature switches), once its deposit is set here." />
      <div className="mt-6 flex flex-wrap gap-3">
        <MarketFilter id="connect-settings-market" value={country} onChange={setCountry} all={false} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <QueryView query={settings} loading={<Skeleton className="h-64 w-full" />}>
          {data => <DepositCard key={`${data.country}:${data.deposit}`} settings={data} changes={can(admin, "finance")} />}
        </QueryView>
        <StatesCard key={country} country={country} changes={can(admin, "operations")} />
      </div>
    </UdozoShell>
  );
}
