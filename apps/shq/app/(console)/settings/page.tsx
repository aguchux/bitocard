"use client";

import { useState, type FormEvent } from "react";
import { Button, Card, CardHeader, ErrorState, errorMessage, Field, Input, KeyValue, Notice, PageHeader, Select, Skeleton, StatusBadge } from "@bitocard/admin-ui";
import { AppLink } from "@bitocard/admin-ui/shell";
import { type ResellerRef, usePublicCountriesQuery, usePublicCountryQuery, useUpdateBusinessMutation } from "@bitocard/api-client/reseller";
import { ShqShell } from "@/components/shq-shell";
import { can, useReseller } from "@/components/reseller";

const statusHelp: Record<ResellerRef["status"], { tone: "amber" | "green" | "red"; title: string; text: string }> = {
  pending: {
    tone: "amber",
    title: "Your account is waiting to go live",
    text: "The business owner completes an identity check before you can take live orders. Some accounts are also reviewed by BitoCard after the check.",
  },
  active: { tone: "green", title: "Your account is active", text: "You can take live orders once your wallet is funded." },
  suspended: { tone: "red", title: "Your account is suspended", text: "Live orders and your store are paused. Contact support to find out why and what to do next." },
};

function CountryPicker({ onSaved }: { onSaved: () => void }) {
  const countries = usePublicCountriesQuery();
  const [country, setCountry] = useState("");
  const [update, state] = useUpdateBusinessMutation();
  const open = countries.data?.data.filter(item => item.reseller_signup) ?? [];

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const done = await update({ country })
      .unwrap()
      .catch(() => null);
    if (done) onSaved();
  };

  if (countries.error) return <ErrorState message={errorMessage(countries.error, "Could not load countries.")} onRetry={countries.refetch} />;
  if (countries.isLoading) return <Skeleton className="h-11 w-full" />;
  return (
    <form onSubmit={submit} className="space-y-3">
      <Notice tone="amber">Choose the country your business operates in. You sell in its currency, and it cannot be changed afterwards without contacting support.</Notice>
      {state.error ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
      <Field label="Business country" htmlFor="business-country">
        <Select id="business-country" value={country} onChange={event => setCountry(event.target.value)} required>
          <option value="" disabled>
            Choose a country
          </option>
          {open.map(item => (
            <option key={item.code} value={item.code}>
              {item.name} ({item.currency})
            </option>
          ))}
        </Select>
      </Field>
      <Button type="submit" loading={state.isLoading} disabled={!country}>
        Set country
      </Button>
    </form>
  );
}

function CountryValue({ code }: { code: string }) {
  const { data, isLoading } = usePublicCountryQuery(code);
  if (isLoading) return <Skeleton className="h-5 w-32" />;
  return <>{data ? `${data.name} (${data.currency})` : code}</>;
}

/** Business details: the name and country, and where the account stands. */
export default function BusinessSettingsPage() {
  const { membership } = useReseller();
  const reseller = membership.reseller;
  const manage = can(membership, "admin");
  const [name, setName] = useState(reseller.name);
  const [saved, setSaved] = useState<string | null>(null);
  const [update, state] = useUpdateBusinessMutation();
  const help = statusHelp[reseller.status];

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaved(null);
    const done = await update({ name: name.trim() })
      .unwrap()
      .catch(() => null);
    if (done) setSaved("Business name saved.");
  };

  return (
    <ShqShell section="settings" current="/settings" crumbs={[{ label: "Settings", href: "/settings" }, { label: "Business" }]}>
      <PageHeader title="Business" description="Your business details and account status." />

      <Card>
        <CardHeader title="Account status" actions={<StatusBadge status={reseller.status} />} />
        <div className="space-y-3 p-5 sm:p-6">
          <Notice tone={help.tone} title={help.title}>
            {help.text}
          </Notice>
          {reseller.status === "pending" ? (
            <p className="text-sm">
              <AppLink href="/settings/verification" className="font-semibold text-brand-600 underline-offset-2 hover:underline">
                Go to the identity check
              </AppLink>
            </p>
          ) : null}
        </div>
      </Card>

      <Card>
        <CardHeader title="Business details" description={manage ? undefined : "Only the owner or an admin can change these."} />
        <div className="space-y-6 p-5 sm:p-6">
          <form onSubmit={save} className="space-y-4">
            {state.error ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
            {saved ? <Notice tone="green">{saved}</Notice> : null}
            <Field label="Business name" htmlFor="business-name" hint="2 to 100 characters.">
              <Input id="business-name" value={name} onChange={event => setName(event.target.value)} maxLength={100} disabled={!manage} required autoComplete="organization" />
            </Field>
            {manage ? (
              <Button type="submit" loading={state.isLoading} disabled={name.trim().length < 2 || name.trim() === reseller.name}>
                Save name
              </Button>
            ) : null}
          </form>

          {reseller.country ? (
            <KeyValue
              items={[
                { label: "Business country", value: <CountryValue code={reseller.country} /> },
                { label: "Changing country", value: "Contact support: your country sets your currency and what you can sell." },
              ]}
            />
          ) : manage ? (
            <CountryPicker onSaved={() => setSaved("Business country saved.")} />
          ) : (
            <Notice tone="amber">Your business country is not set yet. The owner or an admin can set it here.</Notice>
          )}
        </div>
      </Card>
    </ShqShell>
  );
}
