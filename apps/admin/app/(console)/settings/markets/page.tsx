"use client";

import { Suspense } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Card, CardHeader, categoryName, ErrorState, errorMessage, formatMoney, Notice, RefreshFailed, Select, Skeleton, Toggle } from "@bitocard/admin-ui";
import { AdminShell, can, useAdmin } from "@bitocard/admin-ui/shell";
import { useCountriesQuery, useTaxRatesQuery, useUpdateCountryCategoryMutation } from "@bitocard/api-client/admin";
import { PaymentMethods } from "./payment-methods";
import { TaxRateCard } from "./tax-rate";

const fields = [
  { key: "enabled", label: "Sold here" },
  { key: "customer_verification", label: "Customer verification" },
  { key: "taxable", label: "Taxable" },
] as const;

/** Markets: what each country sells and where customers must verify their identity. */
export default function MarketsPage() {
  // useSearchParams needs a Suspense boundary (the chosen country is kept in ?country=).
  return (
    <Suspense>
      <Markets />
    </Suspense>
  );
}

/**
 * One country at a time, chosen from the select on the far right of the title (kept in ?country=, so a reload or a shared link
 * opens the same one): the page stays one screen however many markets there are.
 */
function Markets() {
  const admin = useAdmin();
  const router = useRouter();
  const pathname = usePathname();
  const asked = useSearchParams().get("country")?.toUpperCase() ?? "";
  const { data, error, isFetching, refetch } = useCountriesQuery();
  const [update, state] = useUpdateCountryCategoryMutation();
  const editable = can(admin, "operations");
  const taxRates = useTaxRatesQuery();
  const rate = taxRates.data?.data.find(item => item.country === country?.code);
  const paymentsEditable = can(admin, "operations", "finance");
  const countries = data?.data ?? [];
  const country = countries.find(item => item.code === asked) ?? countries[0];
  const choose = (code: string) => router.replace(`${pathname}?country=${code}`, { scroll: false });

  return (
    <AdminShell section="settings" current="/settings/markets" crumbs={[{ label: "Settings", href: "/settings" }, { label: "Markets" }]}>
      {/* The title and description on the left, the country select on the far right (below them on phones). */}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1 basis-80">
          <h1 className="text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">Markets</h1>
          <p className="mt-1 text-base text-muted">
            Product categories sold in each country, where customers must verify their identity first, and how resellers and customers pay there.
          </p>
        </div>
        {countries.length ? (
          <div className="w-60 max-w-full">
            <Select aria-label="Country" value={country?.code ?? ""} onChange={event => choose(event.target.value)} className="font-semibold">
              {countries.map(item => (
                <option key={item.code} value={item.code}>
                  {item.name} ({item.code})
                </option>
              ))}
            </Select>
          </div>
        ) : null}
      </div>
      {state.error ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
      {data && error && !isFetching ? <RefreshFailed message={errorMessage(error)} onRetry={refetch} /> : null}
      {!data && error ? (
        <Card>
          <ErrorState message={errorMessage(error)} onRetry={refetch} />
        </Card>
      ) : !data ? (
        <Skeleton className="h-64 w-full" />
      ) : !country ? (
        <Card>
          <p className="p-6 text-muted">No markets are set up yet.</p>
        </Card>
      ) : (
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
          {rate && !rate.confirmed && country.categories.some(item => item.enabled && item.taxable) ? (
            <div className="px-4 pb-3 sm:px-6">
              <Notice tone="amber" title="Live sales refused">
                {`${country.categories
                  .filter(item => item.enabled && item.taxable)
                  .map(item => categoryName(item.category))
                  .join(", ")} ${country.categories.filter(item => item.enabled && item.taxable).length === 1 ? "is" : "are"} marked taxable, but ${country.name}'s tax rate is not confirmed, so customers cannot buy ${country.categories.filter(item => item.enabled && item.taxable).length === 1 ? "it" : "them"} live. Confirm the rate below after tax advice, or switch Taxable off.`}
              </Notice>
            </div>
          ) : null}
          <h3 className="px-4 pt-2 pb-3 text-sm font-semibold sm:px-6">Tax</h3>
          <TaxRateCard key={`${country.code}:${rate?.updated_at ?? ""}`} country={country.name} code={country.code} rate={rate ?? null} editable={can(admin, "finance")} />
          <h3 className="px-4 pt-2 pb-3 text-sm font-semibold sm:px-6">Payment methods</h3>
          <PaymentMethods code={country.code} country={country.name} editable={paymentsEditable} />
        </Card>
      )}
    </AdminShell>
  );
}
