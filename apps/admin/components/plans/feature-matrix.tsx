"use client";

import { Fragment, useState } from "react";
import { Card, CardHeader, errorMessage, Notice, Toggle } from "@bitocard/admin-ui";
import { type PlanSettings, useSetPlanFeatureMutation, useSetPlanLimitMutation } from "@bitocard/api-client/admin";

/**
 * Every feature down the side, every plan across the top, a switch in each cell. A change applies to resellers on that
 * plan at once; those losing a feature are told.
 */
const scopeLabel = { store: "Each store", account: "Whole account" } as const;

type LimitDefinition = PlanSettings["limits"][number];

/**
 * One plan's value for one limit: a number, or Unlimited. Saved when the box is left or Enter pressed, and the switch
 * saves at once. Lowering a limit only stops new additions; nothing a reseller already has is removed.
 */
function LimitCell({ plan, limit, editable }: { plan: PlanSettings["plans"][number]; limit: LimitDefinition; editable: boolean }) {
  const [setLimit, state] = useSetPlanLimitMutation();
  const value = plan.limits[limit.code] ?? null;
  const [draft, setDraft] = useState(value === null ? "" : String(value));
  const unlimited = value === null;
  const label = `${limit.name} on ${plan.name}`;
  const save = async (next: number | null) => {
    if (next === value) return;
    await setLimit({ code: plan.code, limit: limit.code, value: next })
      .unwrap()
      .catch(() => setDraft(value === null ? "" : String(value)));
  };
  const commit = () => {
    const trimmed = draft.trim();
    if (!trimmed) return void setDraft(value === null ? "" : String(value));
    const number = Number(trimmed);
    if (!Number.isSafeInteger(number) || number < 0 || number > limit.max) return void setDraft(value === null ? "" : String(value));
    void save(number);
  };
  return (
    <div className="flex flex-col items-center gap-1.5">
      <input
        type="number"
        inputMode="numeric"
        min={0}
        max={limit.max}
        aria-label={label}
        value={unlimited ? "" : draft}
        placeholder={unlimited ? "∞" : undefined}
        disabled={!editable || unlimited || state.isLoading}
        onChange={event => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={event => {
          if (event.key === "Enter") (event.target as HTMLInputElement).blur();
        }}
        className="h-9 w-20 rounded-lg border border-line bg-white px-2 text-center text-sm tabular-nums focus:border-brand-400 focus:ring-2 focus:ring-brand-100 disabled:bg-canvas"
      />
      <label className="flex items-center gap-1 text-xs text-muted">
        <input
          type="checkbox"
          checked={unlimited}
          disabled={!editable || state.isLoading}
          onChange={event => {
            if (event.target.checked) void save(null);
            else {
              const start = limit.default ?? 1;
              setDraft(String(start));
              void save(start);
            }
          }}
          className="size-3.5 accent-brand-500"
        />
        Unlimited
      </label>
      {state.error ? <span className="max-w-24 text-xs text-red-600">{errorMessage(state.error)}</span> : null}
    </div>
  );
}

export function FeatureMatrix({ settings, editable }: { settings: PlanSettings; editable: boolean }) {
  const [setFeature, state] = useSetPlanFeatureMutation();
  const [pending, setPending] = useState<string | null>(null);
  return (
    <Card>
      <CardHeader
        title="Features and limits by plan"
        description="Switch each feature on or off for each plan, and set how much each plan allows. Resellers on the plan follow at once and are told what they lose; anything a plan does not include is refused. Lowering a limit stops new additions and removes nothing."
      />
      <div className="px-5 pb-5 sm:px-6">
        {state.error ? <div className="mb-4"><Notice tone="red">{errorMessage(state.error)}</Notice></div> : null}
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[36rem] text-sm">
            <thead className="bg-canvas">
              <tr>
                <th scope="col" className="px-4 py-3 text-left font-semibold text-ink">Feature</th>
                {settings.plans.map(plan => (
                  <th key={plan.code} scope="col" className="w-28 px-2 py-3 text-center font-semibold text-ink">
                    <span className="block truncate">{plan.name}</span>
                    {!plan.available ? <span className="text-xs font-normal text-muted">Hidden</span> : null}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {settings.groups.map(group => {
                const features = settings.features.filter(feature => feature.group === group.code);
                const limits = settings.limits.filter(limit => limit.group === group.code);
                if (!features.length && !limits.length) return null;
                return (
                  <Fragment key={group.code}>
                    <tr className="border-t border-line bg-canvas/60">
                      <th scope="colgroup" colSpan={settings.plans.length + 1} className="px-4 py-2 text-left text-xs font-semibold tracking-wide text-muted uppercase">
                        {group.name}
                      </th>
                    </tr>
                    {features.map(feature => (
                      <tr key={feature.code} className="border-t border-line">
                        <th scope="row" className="px-4 py-3 text-left font-normal">
                          <span className="block font-semibold text-ink">{feature.name}</span>
                          <span className="block text-xs text-muted">{feature.description}</span>
                          <span className="block text-xs text-muted">{scopeLabel[feature.scope]}</span>
                        </th>
                        {settings.plans.map(plan => {
                          const key = `${plan.code}:${feature.code}`;
                          const on = plan.features.includes(feature.code);
                          return (
                            <td key={plan.code} className="px-2 py-3 text-center">
                              <span className="inline-flex justify-center">
                                <Toggle
                                  checked={on}
                                  label={`${feature.name} on ${plan.name}`}
                                  disabled={!editable || pending === key}
                                  onChange={async enabled => {
                                    setPending(key);
                                    await setFeature({ code: plan.code, feature: feature.code, enabled })
                                      .unwrap()
                                      .catch(() => undefined);
                                    setPending(null);
                                  }}
                                />
                              </span>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                    {limits.map(limit => (
                      <tr key={limit.code} className="border-t border-line">
                        <th scope="row" className="px-4 py-3 text-left font-normal">
                          <span className="block font-semibold text-ink">{limit.name}</span>
                          <span className="block text-xs text-muted">{limit.description}</span>
                          <span className="block text-xs text-muted">{`${scopeLabel[limit.scope]} · default ${limit.default === null ? "unlimited" : limit.default}`}</span>
                        </th>
                        {settings.plans.map(plan => (
                          <td key={plan.code} className="px-2 py-3 text-center">
                            <LimitCell key={`${plan.limits[limit.code]}`} plan={plan} limit={limit} editable={editable} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </Card>
  );
}
