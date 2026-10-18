"use client";

import { useState } from "react";
import { amountToMinor, bpsToPercent, Button, errorMessage, Field, formatMoney, Input, Notice, percentToBps } from "@bitocard/admin-ui";
import { useUpdateCountryMutation } from "@bitocard/api-client/admin";

/** The most a market's cap may be: 20%, as the API accepts (2000 basis points). */
const maxCapBps = 2000;

/** The alert amount in the currency's main unit, for the field ("" when there is none). */
const alertText = (minor: number | null | undefined) => (minor === null || minor === undefined ? "" : (minor / 100).toFixed(2));

/**
 * The exchange in one market (operations): the most a reseller's own desk may mark up the market price here, and the
 * amount below which admins are told BitoCard's money reserve here is running low (blank: never told).
 */
export function ExchangeLimits({
  code,
  country,
  currency,
  capBps,
  alertMinor,
  editable,
}: {
  code: string;
  country: string;
  currency: string;
  capBps: number | undefined;
  alertMinor: number | null | undefined;
  editable: boolean;
}) {
  const [update, state] = useUpdateCountryMutation();
  const [cap, setCap] = useState(bpsToPercent(capBps));
  const [alert, setAlert] = useState(alertText(alertMinor));
  const capValue = percentToBps(cap);
  const alertValue = alert.trim() === "" ? null : amountToMinor(alert);
  const capProblem = capValue === null || capValue > maxCapBps ? "Enter a percentage from 0 to 20, with at most two decimals." : null;
  const alertProblem = alert.trim() !== "" && alertValue === null ? "Enter an amount with at most two decimals, or leave it blank." : null;
  const changed = capValue !== (capBps ?? null) || alertValue !== (alertMinor ?? null);

  if (capBps === undefined) return <p className="px-4 pb-5 text-sm text-muted sm:px-6">Not reported by the API yet.</p>;
  if (!editable) {
    return (
      <p className="px-4 pb-5 text-sm text-muted sm:px-6">
        {`Reseller desks may mark up at most ${capBps / 100}%. `}
        {alertMinor === null || alertMinor === undefined ? "No low reserve alert." : `Admins are told when BitoCard's ${currency} reserve falls below ${formatMoney(alertMinor, currency)}.`}
      </p>
    );
  }
  return (
    <div className="space-y-3 px-4 pb-5 sm:px-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
        <Field label="Most a reseller desk may mark up (%)" htmlFor={`exchange-cap-${code}`} error={capProblem ?? undefined} hint={`On the market price, in ${country}. At most 20%.`}>
          <Input id={`exchange-cap-${code}`} inputMode="decimal" autoComplete="off" value={cap} onChange={event => setCap(event.target.value)} />
        </Field>
        <Field label={`Low reserve alert (${currency})`} htmlFor={`exchange-alert-${code}`} error={alertProblem ?? undefined} hint="Admins are told when BitoCard's money reserve here falls below this. Blank: never.">
          <Input id={`exchange-alert-${code}`} inputMode="decimal" autoComplete="off" placeholder="No alert" value={alert} onChange={event => setAlert(event.target.value)} />
        </Field>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <p className="min-w-0 flex-1 basis-64 text-xs text-muted">A lower cap applies to reseller desks the next time they price a trade. BitoCard&apos;s own markups are set on Crypto &gt; Exchange.</p>
        <Button
          size="sm"
          loading={state.isLoading}
          disabled={!changed || Boolean(capProblem) || Boolean(alertProblem)}
          onClick={() => void update({ code, exchange_markup_cap_bps: capValue ?? undefined, exchange_reserve_alert_minor: alertValue })}
        >
          Save
        </Button>
      </div>
      {state.error ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
    </div>
  );
}
