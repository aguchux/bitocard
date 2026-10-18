"use client";

import { useState } from "react";
import { Button, errorMessage, Field, Input, Notice, Toggle } from "@bitocard/admin-ui";
import { type TaxRate, useSetTaxRateMutation } from "@bitocard/api-client/admin";

/**
 * The country's sales tax, set by finance: name, rate, whether prices include it, and whether it is confirmed after tax
 * advice. Live sales in the country's taxable categories are refused until it is confirmed (the sandbox uses it anyway).
 */
export function TaxRateCard({ country, code, rate, editable }: { country: string; code: string; rate: TaxRate | null; editable: boolean }) {
  const [save, state] = useSetTaxRateMutation();
  const [name, setName] = useState(rate?.name ?? "VAT");
  const [percent, setPercent] = useState(rate ? String(rate.rate_bps / 100) : "");
  const [included, setIncluded] = useState(rate?.prices_include_tax ?? true);
  const [confirmed, setConfirmed] = useState(rate?.confirmed ?? false);
  const bps = Math.round(Number(percent) * 100);
  const valid = name.trim().length >= 2 && percent.trim() !== "" && Number.isFinite(bps) && bps >= 0 && bps <= 5000;
  const changed = !rate || name.trim() !== rate.name || bps !== rate.rate_bps || included !== rate.prices_include_tax || confirmed !== rate.confirmed;
  return (
    <form
      className="space-y-4 px-4 pb-5 sm:px-6"
      onSubmit={event => {
        event.preventDefault();
        if (valid) void save({ country: code, name: name.trim(), rate_bps: bps, prices_include_tax: included, confirmed });
      }}
    >
      {state.error ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
      {!rate ? <Notice tone="grey">{`No tax rate is set for ${country}: sales in its taxable categories are refused.`}</Notice> : null}
      <div className="grid gap-4 sm:grid-cols-[minmax(0,14rem)_minmax(0,9rem)]">
        <Field htmlFor={`tax-name-${code}`} label="Name">
          <Input id={`tax-name-${code}`} value={name} maxLength={40} disabled={!editable} onChange={event => setName(event.target.value)} />
        </Field>
        <Field htmlFor={`tax-rate-${code}`} label="Rate (%)" hint="0 to 50.">
          <Input id={`tax-rate-${code}`} inputMode="decimal" value={percent} disabled={!editable} onChange={event => setPercent(event.target.value)} aria-invalid={(percent !== "" && !valid) || undefined} />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <span className="flex items-center gap-3 rounded-xl border border-line px-4 py-3 text-sm font-medium">
          <Toggle label={`Prices in ${country} include tax`} checked={included} disabled={!editable} onChange={setIncluded} />
          Prices include tax
        </span>
        <span className="flex items-center gap-3 rounded-xl border border-line px-4 py-3 text-sm font-medium">
          <Toggle label={`${country}'s tax rate is confirmed`} checked={confirmed} disabled={!editable} onChange={setConfirmed} />
          Confirmed after tax advice
        </span>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <p className="min-w-0 flex-1 basis-64 text-sm text-muted">
          {rate?.confirmed
            ? "Live sales in taxable categories collect this tax."
            : "Not confirmed: live sales in taxable categories are refused until finance confirms the rate. The sandbox uses it anyway."}
          {editable ? "" : " Only finance admins change tax."}
        </p>
        {editable ? (
          <Button type="submit" size="sm" disabled={!valid || !changed} loading={state.isLoading}>
            Save tax
          </Button>
        ) : null}
      </div>
    </form>
  );
}
