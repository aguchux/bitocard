"use client";

import { Card, CardHeader, categoryName, ErrorState, errorMessage, formatMoney, Notice, PageHeader, RefreshFailed, Skeleton, Toggle } from "@bitocard/admin-ui";
import { AdminShell, can, useAdmin } from "@bitocard/admin-ui/shell";
import { useCountriesQuery, useUpdateCountryCategoryMutation } from "@bitocard/api-client/admin";

const fields = [
  { key: "enabled", label: "Sold here" },
  { key: "customer_verification", label: "Customer verification" },
  { key: "taxable", label: "Taxable" },
] as const;

/** Markets: what each country sells and where customers must verify their identity. */
export default function MarketsPage() {
  const admin = useAdmin();
  const { data, error, isFetching, refetch } = useCountriesQuery();
  const [update, state] = useUpdateCountryCategoryMutation();
  const editable = can(admin, "operations");

  return (
    <AdminShell section="settings" current="/settings/markets" crumbs={[{ label: "Settings", href: "/settings" }, { label: "Markets" }]}>
      <PageHeader
        title="Markets"
        description="Product categories sold in each country, and where customers on hosted storefronts must verify their identity first."
      />
      {state.error ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
      {data && error && !isFetching ? <RefreshFailed message={errorMessage(error)} onRetry={refetch} /> : null}
      {!data && error ? (
        <Card>
          <ErrorState message={errorMessage(error)} onRetry={refetch} />
        </Card>
      ) : !data ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        data.data.map(country => (
          <Card key={country.code}>
            <CardHeader
              title={`${country.name} (${country.code})`}
              description={[
                country.currency,
                `sign-up ${country.reseller_signup ? "open" : "closed"}`,
                `payouts after ${country.payout_hold_days} days`,
                `minimum withdrawal ${formatMoney(country.min_withdrawal_minor, country.currency)}`,
                country.markup_cap_percent !== null ? `markup cap ${country.markup_cap_percent}%` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            />
            <div className="overflow-x-auto px-2 pb-3 sm:px-4">
              <table className="w-full min-w-[480px] text-sm">
                <caption className="sr-only">{`Categories in ${country.name}`}</caption>
                <thead>
                  <tr className="text-left text-xs font-semibold text-muted">
                    <th scope="col" className="px-3 py-3">
                      Category
                    </th>
                    {fields.map(field => (
                      <th key={field.key} scope="col" className="px-3 py-3">
                        {field.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {country.categories.map(item => (
                    <tr key={item.category}>
                      <th scope="row" className="px-3 py-3 text-left font-medium">
                        {categoryName(item.category)}
                      </th>
                      {fields.map(field => (
                        <td key={field.key} className="px-3 py-3">
                          <Toggle
                            label={`${categoryName(item.category)} in ${country.name}: ${field.label}`}
                            checked={item[field.key]}
                            disabled={!editable}
                            onChange={checked => update({ code: country.code, category: item.category, [field.key]: checked })}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ))
      )}
    </AdminShell>
  );
}
