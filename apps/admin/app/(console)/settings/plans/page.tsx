"use client";

import { useState } from "react";
import { Crown, Gift, Save } from "lucide-react";
import { Badge, Button, Card, CardHeader, cn, currencyDigits, errorMessage, Field, formatMoney, Input, Notice, PageHeader, QueryView, Skeleton, Textarea } from "@bitocard/admin-ui";
import { AdminShell, can, useAdmin } from "@bitocard/admin-ui/shell";
import { type PlanFeatureTier, type PlanSettings, usePlanSettingsQuery, useSetPlanFeatureTierMutation, useUpdatePlanMutation } from "@bitocard/api-client/admin";

type PaidPlan = PlanSettings["plans"][number];

/** "35000" or "35,000.50" in a currency's major units, to minor units; null when it is not an amount. */
function toMinor(value: string, currency: string) {
  const digits = currencyDigits(currency);
  const match = new RegExp(`^(\\d{1,12})(?:\\.(\\d{1,${Math.max(digits, 1)}}))?$`).exec(value.replace(/,/g, "").trim());
  if (!match || (digits === 0 && match[2])) return null;
  return Number(match[1]) * 10 ** digits + Number((match[2] ?? "").padEnd(digits, "0") || 0);
}
const toMajor = (minor: number, currency: string) => String(minor / 10 ** currencyDigits(currency));

/** The paid plan's name, description and US dollar price. */
function PlanDetails({ plan, editable }: { plan: PaidPlan; editable: boolean }) {
  const [update, state] = useUpdatePlanMutation();
  const [name, setName] = useState(plan.name);
  const [description, setDescription] = useState(plan.description ?? "");
  const [price, setPrice] = useState(toMajor(plan.price.amount, "USD"));
  const [saved, setSaved] = useState(false);
  const cents = toMinor(price, "USD");
  const changed = name !== plan.name || description !== (plan.description ?? "") || cents !== plan.price.amount;
  return (
    <Card>
      <CardHeader title={`${plan.name} plan`} description={`${plan.resellers} reseller${plan.resellers === 1 ? "" : "s"} on it now. Charged monthly from their live wallet.`} actions={<Badge tone="pink">Paid</Badge>} />
      <form
        className="grid gap-4 px-5 pb-5 sm:px-6 md:grid-cols-2"
        onSubmit={async event => {
          event.preventDefault();
          if (cents === null || cents === 0) return;
          setSaved(false);
          await update({ code: plan.code, name, description: description || null, price_cents: cents })
            .unwrap()
            .then(() => setSaved(true))
            .catch(() => undefined);
        }}
      >
        <Field label="Name" htmlFor="plan-name">
          <Input id="plan-name" value={name} maxLength={40} disabled={!editable} onChange={event => setName(event.target.value)} />
        </Field>
        <Field label="Price a month (US dollars)" htmlFor="plan-price" hint="Used where no local price is set below: converted at the day's rate when charged." error={price && (cents === null || cents === 0) ? "Enter a price above zero, like 25 or 24.99." : undefined}>
          <Input id="plan-price" inputMode="decimal" value={price} disabled={!editable} onChange={event => setPrice(event.target.value)} />
        </Field>
        <div className="md:col-span-2">
          <Field label="Description" htmlFor="plan-description" hint="Shown to resellers with the plan.">
            <Textarea id="plan-description" rows={2} maxLength={300} value={description} disabled={!editable} onChange={event => setDescription(event.target.value)} />
          </Field>
        </div>
        {state.error ? <div className="md:col-span-2"><Notice tone="red">{errorMessage(state.error)}</Notice></div> : null}
        {saved && !changed ? <div className="md:col-span-2"><Notice tone="green">Saved. Resellers see it at once; renewals charge the new price from their next renewal.</Notice></div> : null}
        {editable ? (
          <div className="md:col-span-2">
            <Button type="submit" icon={<Save className="size-4" aria-hidden />} loading={state.isLoading} disabled={!changed || cents === null || cents === 0}>
              Save plan
            </Button>
          </div>
        ) : null}
      </form>
    </Card>
  );
}

/** Fixed monthly prices in each market currency; blank means the US dollar price converted on the day. */
function LocalPrices({ plan, editable }: { plan: PaidPlan; editable: boolean }) {
  const [update, state] = useUpdatePlanMutation();
  const initial = Object.fromEntries(plan.local_prices.map(row => [row.currency, row.fixed === null ? "" : toMajor(row.fixed, row.currency)]));
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [saved, setSaved] = useState(false);
  const problems = plan.local_prices.filter(row => values[row.currency]?.trim() && !toMinor(values[row.currency], row.currency));
  const changes = Object.fromEntries(
    plan.local_prices
      .filter(row => (values[row.currency] ?? "") !== initial[row.currency])
      .map(row => [row.currency, values[row.currency]?.trim() ? toMinor(values[row.currency], row.currency) : null]),
  );
  const count = Object.keys(changes).length;
  return (
    <Card>
      <CardHeader
        title="Prices in local currencies"
        description="Resellers pay in their own currency. Set a fixed monthly price to charge a set amount; leave it blank to charge the US dollar price at the day's rate."
      />
      <div className="px-5 pb-5 sm:px-6">
        {plan.local_prices.length === 0 ? (
          <Notice tone="grey">No markets use a currency other than US dollars yet.</Notice>
        ) : (
          <ul className="divide-y divide-line rounded-xl border border-line">
            {plan.local_prices.map(row => {
              const id = `local-${row.currency}`;
              const invalid = problems.some(item => item.currency === row.currency);
              return (
                <li key={row.currency} className="grid items-center gap-3 p-4 sm:grid-cols-[1fr_14rem]">
                  <div className="min-w-0">
                    <label htmlFor={id} className="font-semibold text-ink">
                      {row.currency}
                    </label>
                    <p className="truncate text-sm text-muted">{row.markets.join(", ")}</p>
                    <p className="text-xs text-muted">
                      {row.fixed !== null
                        ? `Charged now: ${formatMoney(row.fixed, row.currency)} (fixed)`
                        : row.charged !== null
                          ? `Charged now: ${formatMoney(row.charged, row.currency)} (converted today)`
                          : "No exchange rate today: set a fixed price, or renewals wait for a rate."}
                    </p>
                  </div>
                  <div>
                    <Input
                      id={id}
                      inputMode="decimal"
                      placeholder={row.charged !== null && row.fixed === null ? toMajor(row.charged, row.currency) : "Converted"}
                      value={values[row.currency] ?? ""}
                      disabled={!editable}
                      aria-invalid={invalid}
                      onChange={event => {
                        setSaved(false);
                        setValues(current => ({ ...current, [row.currency]: event.target.value }));
                      }}
                    />
                    {invalid ? <p className="mt-1 text-xs text-red-600">Enter an amount above zero.</p> : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {state.error ? <div className="mt-4"><Notice tone="red">{errorMessage(state.error)}</Notice></div> : null}
        {saved && count === 0 ? <div className="mt-4"><Notice tone="green">Saved. New upgrades and the next renewals use these prices.</Notice></div> : null}
        {editable && plan.local_prices.length ? (
          <Button
            className="mt-4"
            icon={<Save className="size-4" aria-hidden />}
            loading={state.isLoading}
            disabled={count === 0 || problems.length > 0}
            onClick={async () => {
              await update({ code: plan.code, local_prices: changes as Record<string, number | null> })
                .unwrap()
                .then(() => setSaved(true))
                .catch(() => undefined);
            }}
          >
            {count ? `Save ${count} price${count === 1 ? "" : "s"}` : "Save prices"}
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

const tiers: Array<{ value: PlanFeatureTier; label: string; icon: typeof Gift }> = [
  { value: "free", label: "Free", icon: Gift },
  { value: "premium", label: "Premium", icon: Crown },
];

/** Each plan feature on every plan (Free) or on paid plans only (Premium). */
function Features({ settings, editable }: { settings: PlanSettings; editable: boolean }) {
  const [setTier, state] = useSetPlanFeatureTierMutation();
  const [pending, setPending] = useState<string | null>(null);
  const free = settings.plans.find(plan => plan.free);
  return (
    <Card>
      <CardHeader
        title="Features"
        description={`Free features are on every plan; Premium ones only on paid plans. A change applies to resellers at once${free ? ` (${free.resellers} on ${free.name} now)` : ""}.`}
      />
      <div className="px-5 pb-5 sm:px-6">
        {state.error ? <div className="mb-4"><Notice tone="red">{errorMessage(state.error)}</Notice></div> : null}
        <ul className="divide-y divide-line rounded-xl border border-line">
          {settings.features.map(feature => (
            <li key={feature.code} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="font-semibold text-ink">{feature.name}</p>
                <p className="text-sm text-muted">{feature.description}</p>
              </div>
              <div role="radiogroup" aria-label={`${feature.name}: which plans`} className="inline-flex shrink-0 rounded-xl bg-canvas p-1 ring-1 ring-line">
                {tiers.map(tier => {
                  const active = feature.tier === tier.value;
                  return (
                    <button
                      key={tier.value}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      disabled={!editable || pending === feature.code}
                      onClick={async () => {
                        if (active) return;
                        setPending(feature.code);
                        await setTier({ feature: feature.code, tier: tier.value })
                          .unwrap()
                          .catch(() => undefined);
                        setPending(null);
                      }}
                      className={cn(
                        "inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold transition-colors disabled:cursor-not-allowed",
                        active ? (tier.value === "premium" ? "bg-brand-500 text-white shadow-sm" : "bg-white text-ink shadow-sm") : "text-muted hover:text-ink",
                      )}
                    >
                      <tier.icon className="size-4" aria-hidden />
                      {tier.label}
                    </button>
                  );
                })}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

/** Settings > Plans: the paid plan's details and local prices, and which features are free or Premium. */
export default function PlansPage() {
  const admin = useAdmin();
  const editable = can(admin, "finance");
  const settings = usePlanSettingsQuery();
  return (
    <AdminShell section="settings" current="/settings/plans" crumbs={[{ label: "Settings", href: "/settings" }, { label: "Plans" }]}>
      <PageHeader title="Plans" description="Standard is free. Premium is billed monthly from the reseller's live wallet, in their own currency." />
      {!editable ? <Notice tone="grey">Only finance admins can change plans.</Notice> : null}
      <QueryView query={settings} message={error => errorMessage(error, "Could not load the plans.")} loading={<Skeleton className="h-96 w-full" />}>
        {data => (
          <div className="space-y-5">
            {data.plans
              .filter(plan => !plan.free)
              .map(plan => (
                <div key={plan.code} className="space-y-5">
                  <PlanDetails plan={plan} editable={editable} />
                  <LocalPrices plan={plan} editable={editable} />
                </div>
              ))}
            <Features settings={data} editable={editable} />
          </div>
        )}
      </QueryView>
    </AdminShell>
  );
}
