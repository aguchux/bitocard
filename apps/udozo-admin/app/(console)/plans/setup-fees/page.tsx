"use client";

import { useState } from "react";
import { Save, TriangleAlert } from "lucide-react";
import { Badge, Button, Card, errorMessage, Field, formatMoney, Input, KeyValue, Notice, PageHeader, QueryView, Skeleton, Toggle } from "@bitocard/admin-ui";
import { can, useAdmin } from "@bitocard/admin-ui/shell";
import { UdozoShell } from "@/components/shell";
import { toMajor, toMinor } from "@/components/plans/amounts";
import { type SetupFeeSetting, useSetSetupFeeMutation, useSetupFeesQuery } from "@bitocard/api-client/admin";

/** Money in the market's currency, or why it is not known. */
const shown = (amount: number | null, currency: string, unknown: string) => (amount === null ? unknown : formatMoney(amount, currency));

/**
 * One market's setup fee: on or off and its amount (finance; saving asks for the authenticator code), with what a new
 * Premium store brings in against the dearest domain Udozo may have to buy for it.
 */
function MarketFee({ fee, editable }: { fee: SetupFeeSetting; editable: boolean }) {
  const [enabled, setEnabled] = useState(fee.enabled);
  const [amount, setAmount] = useState(fee.amount ? toMajor(fee.amount, fee.currency) : "");
  const [save, state] = useSetSetupFeeMutation();
  const [saved, setSaved] = useState(false);
  const id = `setup-fee-${fee.country}`;
  const minor = amount.trim() ? toMinor(amount, fee.currency) : 0;
  const invalid = minor === null || (enabled && minor === 0);
  const changed = enabled !== fee.enabled || minor !== fee.amount;
  const belowDomain = fee.warnings.includes("fees_below_domain_price");
  const collected = (fee.enabled ? fee.amount : 0) + (fee.premium_month ?? 0);

  return (
    <li className="space-y-4 p-5 sm:p-6" aria-label={fee.name}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-ink">{fee.name}</h2>
          <p className="text-sm text-muted">{`${fee.country} · ${fee.currency}`}</p>
        </div>
        <div className="flex items-center gap-3">
          <Badge tone={fee.enabled ? "green" : "grey"}>{fee.enabled ? `On: ${formatMoney(fee.amount, fee.currency)}` : "Off"}</Badge>
          <Toggle
            label={`Charge a setup fee in ${fee.name}`}
            checked={enabled}
            disabled={!editable}
            onChange={value => {
              setSaved(false);
              setEnabled(value);
            }}
          />
        </div>
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
      <div className="grid items-end gap-3 sm:grid-cols-[minmax(0,16rem)_auto]">
        <Field label={`Amount (${fee.currency})`} htmlFor={id} error={amount.trim() && minor === null ? "Enter an amount, such as 5000 or 5000.50." : enabled && minor === 0 ? "Set an amount above zero, or switch the fee off." : undefined}>
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
              await save({ country: fee.country, enabled, amount: minor ?? 0 })
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
      {saved && !changed ? <Notice tone="green">Saved. New sellers in this market pay it before their first store goes live.</Notice> : null}
    </li>
  );
}

/**
 * Plans & fees > Setup fees: Seller HQ's one-time setup fee per market. Charged once from the seller's wallet (or with
 * their first Premium month); going live waits until it is paid. With one Premium month it must cover the free domain.
 */
export default function SetupFeesPage() {
  const admin = useAdmin();
  const editable = can(admin, "finance");
  const fees = useSetupFeesQuery();
  return (
    <UdozoShell section="plans" current="/plans/setup-fees" crumbs={[{ label: "Plans & fees", href: "/plans" }, { label: "Setup fees" }]}>
      <PageHeader
        title="Setup fees"
        description="A one-time Seller HQ fee per market, taken from the seller's wallet or with their first Premium month. A store goes live only once it is paid. With one Premium month it pays for Premium's free domain."
      />
      {!editable ? <Notice tone="grey">Only finance admins can change setup fees.</Notice> : null}
      <QueryView query={fees} message={error => errorMessage(error, "Could not load the setup fees.")} loading={<Skeleton className="h-64 w-full" />}>
        {data =>
          data.data.length ? (
            <Card>
              <ul className="divide-y divide-line">
                {data.data.map(fee => (
                  <MarketFee key={fee.country} fee={fee} editable={editable} />
                ))}
              </ul>
            </Card>
          ) : (
            <Notice tone="grey">No markets yet. Add one in Settings &gt; Markets.</Notice>
          )
        }
      </QueryView>
    </UdozoShell>
  );
}
