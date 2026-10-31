"use client";

import { PaidPlansNotice } from "@/components/paid-plans";
import { useState } from "react";
import { Globe, RotateCcw, Save, TriangleAlert } from "lucide-react";
import { Badge, Button, Card, errorMessage, Field, formatMoney, Input, KeyValue, Notice, PageHeader, QueryView, Skeleton, Toggle } from "@bitocard/admin-ui";
import { can, useAdmin } from "@bitocard/admin-ui/shell";
import { UdozoShell } from "@/components/shell";
import { toMajor, toMinor } from "@/components/plans/amounts";
import { type SetupFeeDefault, type SetupFeeSetting, useClearSetupFeeMutation, useSetSetupFeeMutation, useSetupFeesQuery } from "@bitocard/api-client/admin";

/** Money in the market's currency, or why it is not known. */
const shown = (amount: number | null, currency: string, unknown: string) => (amount === null ? unknown : formatMoney(amount, currency));

/** The switch, the amount and Save, for one fee (a market's in its currency, or every market's in US dollars). */
function FeeForm({ id, label, country, currency, enabled: savedEnabled, amount: savedAmount, editable, savedText }: { id: string; label: string; country: string; currency: string; enabled: boolean; amount: number; editable: boolean; savedText: string }) {
  const [enabled, setEnabled] = useState(savedEnabled);
  const [amount, setAmount] = useState(savedAmount ? toMajor(savedAmount, currency) : "");
  const [save, state] = useSetSetupFeeMutation();
  const [saved, setSaved] = useState(false);
  const minor = amount.trim() ? toMinor(amount, currency) : 0;
  const invalid = minor === null || (enabled && minor === 0);
  const changed = enabled !== savedEnabled || minor !== savedAmount;
  return (
    <div className="space-y-3">
      <Toggle
        label={label}
        checked={enabled}
        disabled={!editable}
        onChange={value => {
          setSaved(false);
          setEnabled(value);
        }}
      />
      <div className="grid items-end gap-3 sm:grid-cols-[minmax(0,16rem)_auto]">
        <Field label={`Amount (${currency})`} htmlFor={id} error={amount.trim() && minor === null ? "Enter an amount, such as 10 or 10.50." : enabled && minor === 0 ? "Set an amount above zero, or switch the fee off." : undefined}>
          <Input
            id={id}
            inputMode="decimal"
            value={amount}
            disabled={!editable}
            aria-invalid={invalid}
            onChange={event => {
              setSaved(false);
              setAmount(event.target.value);
            }}
          />
        </Field>
        {editable ? (
          <Button
            icon={<Save className="size-4" aria-hidden />}
            loading={state.isLoading}
            disabled={!changed || invalid}
            onClick={async () => {
              await save({ country, enabled, amount: minor ?? 0 })
                .unwrap()
                .then(() => setSaved(true))
                .catch(() => undefined);
            }}
          >
            Save
          </Button>
        ) : null}
      </div>
      {state.error ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
      {saved && !changed ? <Notice tone="green">{savedText}</Notice> : null}
    </div>
  );
}

/** Udozo's fee for every market without its own: set in US dollars, charged in each market's currency at the day's rate. */
function EveryMarket({ fee, editable }: { fee: SetupFeeDefault; editable: boolean }) {
  return (
    <Card>
      <div className="space-y-4 p-5 sm:p-6" aria-label="Every market">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <Globe className="mt-1 size-5 shrink-0 text-muted" aria-hidden />
            <div>
              <h2 className="text-lg font-bold text-ink">Every market</h2>
              <p className="text-sm text-muted">In US dollars, charged in each market&apos;s currency at the day&apos;s rate. A market with its own fee below charges that instead.</p>
            </div>
          </div>
          <Badge tone={fee.enabled ? "green" : "grey"}>{fee.enabled ? `On: ${formatMoney(fee.amount, "USD")}` : "Off"}</Badge>
        </div>
        <FeeForm id="setup-fee-WW" label="Charge a setup fee in every market" country="WW" currency="USD" enabled={fee.enabled} amount={fee.amount} editable={editable} savedText="Saved. Markets without their own fee charge it from now on." />
      </div>
    </Card>
  );
}

/**
 * One market's setup fee: Udozo's for every market (converted) or its own (finance; saving asks for the authenticator
 * code), with what a new Premium store brings in against the dearest domain Udozo may have to buy for it.
 */
function MarketFee({ fee, editable }: { fee: SetupFeeSetting; editable: boolean }) {
  const [own, setOwn] = useState(fee.source === "market");
  const [clear, clearing] = useClearSetupFeeMutation();
  const belowDomain = fee.warnings.includes("fees_below_domain_price");
  const collected = (fee.enabled ? (fee.amount ?? 0) : 0) + (fee.premium_month ?? 0);
  const following = fee.source !== "market";
  const badge = !fee.enabled ? "Off" : fee.amount === null ? "On: no exchange rate yet" : `On: ${formatMoney(fee.amount, fee.currency)}`;

  return (
    <li className="space-y-4 p-5 sm:p-6" aria-label={fee.name}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-ink">{fee.name}</h2>
          <p className="text-sm text-muted">{`${fee.country} · ${fee.currency} · ${following ? "Every market's fee" : "Its own fee"}`}</p>
        </div>
        <Badge tone={fee.enabled ? "green" : "grey"}>{badge}</Badge>
      </div>
      {belowDomain ? (
        <Notice tone="amber" title="The fees may not cover a free domain">
          <span className="inline-flex items-start gap-1.5">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            {`The setup fee and one Premium month bring in ${formatMoney(collected, fee.currency)}, less than the dearest domain on offer (${shown(fee.dearest_domain, fee.currency, "unknown")}). A free domain dearer than what was collected is refused, so raise the fee or Premium's price here.`}
          </span>
        </Notice>
      ) : null}
      <KeyValue
        items={[
          { label: "One Premium month", value: shown(fee.premium_month, fee.currency, "No price yet (no exchange rate)") },
          { label: "Dearest domain on offer", value: shown(fee.dearest_domain, fee.currency, "Not known yet") },
        ]}
      />
      {own ? (
        <div className="space-y-3">
          <FeeForm
            id={`setup-fee-${fee.country}`}
            label={`Charge a setup fee in ${fee.name}`}
            country={fee.country}
            currency={fee.currency}
            enabled={fee.source === "market" ? fee.enabled : false}
            amount={fee.source === "market" ? (fee.amount ?? 0) : 0}
            editable={editable}
            savedText="Saved. New sellers in this market pay it before their first store goes live."
          />
          {editable && fee.source === "market" ? (
            <Button
              variant="secondary"
              icon={<RotateCcw className="size-4" aria-hidden />}
              loading={clearing.isLoading}
              onClick={async () => {
                await clear(fee.country)
                  .unwrap()
                  .then(() => setOwn(false))
                  .catch(() => undefined);
              }}
            >
              Use every market&apos;s fee
            </Button>
          ) : null}
          {clearing.error ? <Notice tone="red">{errorMessage(clearing.error)}</Notice> : null}
        </div>
      ) : editable ? (
        <Button variant="secondary" onClick={() => setOwn(true)}>
          Set its own fee
        </Button>
      ) : null}
    </li>
  );
}

/**
 * Plans & fees > Setup fees: Seller HQ's one-time setup fee, for every market in US dollars and, where set, a market's
 * own. Charged once from the seller's wallet (or with their first Premium month); going live waits until it is paid.
 * With one Premium month it must cover the free domain.
 */
export default function SetupFeesPage() {
  const admin = useAdmin();
  const editable = can(admin, "finance");
  const fees = useSetupFeesQuery();
  return (
    <UdozoShell section="plans" current="/plans/setup-fees" crumbs={[{ label: "Plans & fees", href: "/plans" }, { label: "Setup fees" }]}>
      <PageHeader
        title="Setup fees"
        description="A one-time Seller HQ fee, taken from the seller's wallet or with their first Premium month. A store goes live only once it is paid. With one Premium month it pays for Premium's free domain."
      />
      <PaidPlansNotice />
      {!editable ? <Notice tone="grey">Only finance admins can change setup fees.</Notice> : null}
      <QueryView query={fees} message={error => errorMessage(error, "Could not load the setup fees.")} loading={<Skeleton className="h-64 w-full" />}>
        {data => (
          <div className="space-y-4">
            <EveryMarket key={`${data.every_market.enabled}-${data.every_market.amount}`} fee={data.every_market} editable={editable} />
            {data.data.length ? (
              <Card>
                <ul className="divide-y divide-line">
                  {data.data.map(fee => (
                    <MarketFee key={`${fee.country}-${fee.source}`} fee={fee} editable={editable} />
                  ))}
                </ul>
              </Card>
            ) : (
              <Notice tone="grey">No markets yet. Add one in Settings &gt; Markets.</Notice>
            )}
          </div>
        )}
      </QueryView>
    </UdozoShell>
  );
}
