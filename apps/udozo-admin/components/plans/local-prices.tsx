"use client";

import { useState } from "react";
import { Save } from "lucide-react";
import { Button, Card, CardHeader, errorMessage, formatMoney, Input, Notice } from "@bitocard/admin-ui";
import { useUpdatePlanMutation } from "@bitocard/api-client/admin";
import { SettingsPlan, toMinor, toMajor } from "@/components/plans/amounts";

/** Fixed monthly prices in each market currency; blank means the US dollar price converted on the day. */
export function LocalPrices({ plan, editable }: { plan: SettingsPlan; editable: boolean }) {
  const [update, state] = useUpdatePlanMutation();
  const initial = Object.fromEntries(plan.local_prices.map(row => [row.currency, row.fixed === null ? "" : toMajor(row.fixed, row.currency)]));
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [saved, setSaved] = useState(false);
  if (plan.free) return null;
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
              const id = `local-${plan.code}-${row.currency}`;
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
        {saved && count === 0 ? <div className="mt-4"><Notice tone="green">Saved. New subscriptions and the next renewals use these prices.</Notice></div> : null}
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
