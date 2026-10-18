"use client";

import { errorMessage, Notice, Select } from "@bitocard/admin-ui";
import { useUpdateCountryMutation } from "@bitocard/api-client/admin";

/** 1 to 10 spins a day, as the API accepts. */
const choices = Array.from({ length: 10 }, (_, index) => index + 1);

/**
 * Spin and win's spins per customer per day in a market (operations). It applies from the next spin; the promotion
 * itself is switched on and off with the `spin_rewards` feature switch.
 */
export function SpinLimit({ code, country, limit, editable }: { code: string; country: string; limit: number | undefined; editable: boolean }) {
  const [update, state] = useUpdateCountryMutation();
  return (
    <div className="space-y-3 px-4 pb-5 sm:px-6">
      <div className="space-y-1.5">
        <label htmlFor={`spin-limit-${code}`} className="block text-sm font-semibold text-ink">{`Spins per customer per day in ${country}`}</label>
        <div className="w-32">
          <Select
            id={`spin-limit-${code}`}
            value={limit ?? ""}
            disabled={!editable || state.isLoading || limit === undefined}
            onChange={event => void update({ code, spin_daily_limit: Number(event.target.value) })}
          >
            {limit === undefined ? <option value="">Not reported</option> : null}
            {choices.map(value => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <p className="text-xs text-muted">Days start at midnight UTC. Each customer still wins the same in all; fewer spins a day only spreads it over more days. Switch the promotion on or off in Feature switches (Spin and win).</p>
      {state.error ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
    </div>
  );
}
