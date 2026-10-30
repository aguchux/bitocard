"use client";

import { errorMessage, Notice, Select } from "@bitocard/admin-ui";
import { type IdentityProvider as Provider, useUpdateCountryMutation } from "@bitocard/api-client/admin";

const providers: Record<Provider, string> = {
  bitocard: "Udozo Verify (our own checks, reviewed by a person)",
  didit: "Didit (the identity partner’s hosted check)",
};

/**
 * Who runs identity checks in a market: Udozo Verify (African markets by default; resellers there also verify their
 * business) or Didit. Applies to checks started after the change; BVN checks for Nigerian bank accounts are unchanged.
 */
export function IdentityProvider({ code, country, provider, editable }: { code: string; country: string; provider: Provider | undefined; editable: boolean }) {
  const [update, state] = useUpdateCountryMutation();
  return (
    <div className="space-y-3 px-4 pb-5 sm:px-6">
      <div className="space-y-1.5">
        <label htmlFor={`identity-provider-${code}`} className="block text-sm font-semibold text-ink">{`Checks in ${country}`}</label>
        <div className="w-full max-w-md">
          <Select
            id={`identity-provider-${code}`}
            value={provider ?? ""}
            disabled={!editable || state.isLoading || provider === undefined}
            onChange={event => void update({ code, identity_provider: event.target.value as Provider })}
          >
            {provider === undefined ? <option value="">Not reported by the API yet</option> : null}
            {(Object.entries(providers) as Array<[Provider, string]>).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <p className="text-xs text-muted">New checks only: checks already started finish where they began. Nigeria’s BVN checks for bank accounts are not affected.</p>
      {state.error ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
    </div>
  );
}
