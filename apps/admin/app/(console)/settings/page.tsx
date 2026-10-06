"use client";

import { Card, CardHeader, ErrorState, errorMessage, humanise, Notice, PageHeader, RefreshFailed, Skeleton, Toggle } from "@bitocard/admin-ui";
import { AdminShell, can, useAdmin } from "@bitocard/admin-ui/shell";
import { useCountriesQuery, useSetSwitchMutation, useSwitchesQuery } from "@bitocard/api-client/admin";

/** Global and per-country feature switches. Switches set for one reseller stay in the API for now. */
export default function SwitchesPage() {
  const admin = useAdmin();
  const { data, error, isFetching, refetch } = useSwitchesQuery();
  const countries = useCountriesQuery();
  const [setSwitch, state] = useSetSwitchMutation();
  const editable = can(admin, "operations");

  const value = (key: string, country?: string) =>
    data?.data.find(row => row.key === key && (country ? row.country_code === country : row.scope === "global"))?.enabled;

  return (
    <AdminShell section="settings" current="/settings" crumbs={[{ label: "Settings", href: "/settings" }, { label: "Feature switches" }]}>
      <PageHeader
        title="Feature switches"
        description="Turn gated features on globally or per country. A country setting overrides the global one; a reseller setting overrides both."
      />
      {state.error ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
      {data && error && !isFetching ? <RefreshFailed message={errorMessage(error)} onRetry={refetch} /> : null}
      {!data && error ? (
        <Card>
          <ErrorState message={errorMessage(error)} onRetry={refetch} />
        </Card>
      ) : !data ? (
        <Skeleton className="h-48 w-full" />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {Object.entries(data.definitions).map(([key, definition]) => (
            <Card key={key}>
              <CardHeader title={humanise(key)} description={definition.description} />
              <ul className="divide-y divide-line px-5 py-2 sm:px-6">
                {definition.scopes.includes("global") ? (
                  <li className="flex min-h-14 items-center justify-between gap-3">
                    <span className="text-sm font-medium">Everywhere (global)</span>
                    <Toggle
                      label={`${humanise(key)} globally`}
                      checked={Boolean(value(key))}
                      disabled={!editable}
                      onChange={enabled => setSwitch({ key, enabled })}
                    />
                  </li>
                ) : null}
                {definition.scopes.includes("country")
                  ? countries.data?.data.map(country => {
                      const set = value(key, country.code);
                      return (
                        <li key={country.code} className="flex min-h-14 items-center justify-between gap-3">
                          <span className="text-sm">
                            {country.name}
                            <span className="ml-2 text-xs text-muted">{set === undefined ? "uses global" : "set for this country"}</span>
                          </span>
                          <span className="flex items-center gap-3">
                            {set !== undefined && editable ? (
                              <button
                                type="button"
                                className="text-xs font-semibold text-muted hover:text-ink"
                                onClick={() => setSwitch({ key, country_code: country.code, enabled: null })}
                              >
                                Reset
                              </button>
                            ) : null}
                            <Toggle
                              label={`${humanise(key)} in ${country.name}`}
                              checked={set ?? Boolean(value(key))}
                              disabled={!editable}
                              onChange={enabled => setSwitch({ key, country_code: country.code, enabled })}
                            />
                          </span>
                        </li>
                      );
                    })
                  : null}
                {!definition.scopes.includes("global") && !definition.scopes.includes("country") ? (
                  <li className="py-4 text-sm text-muted">Set per reseller only.</li>
                ) : null}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </AdminShell>
  );
}
