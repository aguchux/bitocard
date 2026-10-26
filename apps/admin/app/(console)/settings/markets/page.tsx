"use client";

import { Suspense } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeftRight, CreditCard, KeyRound, LayoutGrid, Receipt, ShieldCheck, Smartphone } from "lucide-react";
import { Card, categoryName, PanelNav, SettingsPanel, ErrorState, errorMessage, formatMoney, Notice, RefreshFailed, Select, Skeleton, Toggle } from "@bitocard/admin-ui";
import { AdminShell, can, useAdmin } from "@bitocard/admin-ui/shell";
import { useCountriesQuery, useTaxRatesQuery, useUpdateCountryCategoryMutation } from "@bitocard/api-client/admin";
import { ExchangeLimits } from "./exchange-limits";
import { IdentityProvider } from "./identity-provider";
import { SmsProvider } from "./sms-provider";
import { PaymentMethods } from "./payment-methods";
import { TaxRateCard } from "./tax-rate";
import { TwoStepSignIn } from "./two-step";


const fields = [
  { key: "enabled", label: "Sold here" },
  { key: "customer_verification", label: "Customer verification" },
  { key: "taxable", label: "Taxable" },
] as const;

/** The groups of a market's settings, in page order. */
const panels = [
  { id: "categories", label: "Categories", icon: LayoutGrid },
  { id: "identity", label: "Identity checks", icon: ShieldCheck },
  { id: "phone", label: "Phone verification", icon: Smartphone },
  { id: "payments", label: "Payment methods", icon: CreditCard },
  { id: "tax", label: "Tax", icon: Receipt },
  { id: "exchange", label: "Exchange", icon: ArrowLeftRight },
  { id: "two-step", label: "Two-step sign-in", icon: KeyRound },
];

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
  const paymentsEditable = can(admin, "operations", "finance");
  const countries = data?.data ?? [];
  const country = countries.find(item => item.code === asked) ?? countries[0];
  const rate = taxRates.data?.data.find(item => item.country === country?.code);
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
        <div key={country.code} className="space-y-5">
          {/* The market at a glance, then a link to each group of settings. */}
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center gap-4 px-4 py-4 sm:px-6">
              {/* eslint-disable-next-line @next/next/no-img-element -- the app's own flag file */}
              <img src={`/flags/${country.code.toLowerCase()}.svg`} alt="" width={48} height={32} className="h-8 w-12 shrink-0 rounded-md object-cover ring-1 ring-line" />
              <div className="min-w-0 flex-1">
                <h2 className="text-xl font-extrabold tracking-tight text-ink">{`${country.name} (${country.code})`}</h2>
                <dl className="mt-2 flex flex-wrap gap-2 text-xs">
                  {[
                    ["Currency", country.currency],
                    ["Reseller sign-up", country.reseller_signup ? "Open" : "Closed"],
                    ["Payout hold", `${country.payout_hold_days} days`],
                    ["Minimum withdrawal", formatMoney(country.min_withdrawal_minor, country.currency)],
                    ...(country.markup_cap_percent !== null ? [["Markup cap", `${country.markup_cap_percent}%`]] : []),
                  ].map(([term, value]) => (
                    <div key={term} className="inline-flex items-center gap-1.5 rounded-full bg-canvas px-2.5 py-1 ring-1 ring-line">
                      <dt className="text-muted">{term}</dt>
                      <dd className="font-semibold text-ink">{value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>
            <div className="border-t border-line bg-canvas/60 px-4 py-3 sm:px-6">
              <PanelNav items={panels} />
            </div>
          </Card>

          <SettingsPanel id="categories" icon={LayoutGrid} title="Categories" description={`What is sold in ${country.name}, where customers verify their identity first, and what is taxed.`}>
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
          </SettingsPanel>

          <div className="grid gap-5 xl:grid-cols-2">
            <SettingsPanel id="identity" icon={ShieldCheck} title="Identity checks" description="Who checks people and businesses here.">
              <IdentityProvider code={country.code} country={country.name} provider={country.identity_provider} editable={editable} />
            </SettingsPanel>
            <SettingsPanel id="phone" icon={Smartphone} title="Phone verification" description="Who sends the SMS codes that confirm mobile numbers.">
              <SmsProvider code={country.code} provider={country.sms_provider ?? null} editable={editable} />
            </SettingsPanel>
          </div>

          <SettingsPanel id="payments" icon={CreditCard} title="Payment methods" description={`How resellers top up and customers pay in ${country.name}, in the order offered.`}>
            <PaymentMethods code={country.code} country={country.name} editable={paymentsEditable} />
          </SettingsPanel>

          <SettingsPanel id="tax" icon={Receipt} title="Tax" description="The rate charged on taxable categories, confirmed by finance after tax advice.">
            <TaxRateCard key={`${country.code}:${rate?.updated_at ?? ""}`} country={country.name} code={country.code} rate={rate ?? null} editable={can(admin, "finance")} />
          </SettingsPanel>

          <div className="grid gap-5 xl:grid-cols-2">
            <SettingsPanel id="exchange" icon={ArrowLeftRight} title="Exchange" description="Limits for reseller desks and BitoCard's money reserve here.">
              <ExchangeLimits
                key={`${country.code}:${country.exchange_markup_cap_bps ?? ""}:${country.exchange_reserve_alert_minor ?? ""}`}
                code={country.code}
                country={country.name}
                currency={country.currency}
                capBps={country.exchange_markup_cap_bps}
                alertMinor={country.exchange_reserve_alert_minor}
                editable={editable}
              />
            </SettingsPanel>
            <SettingsPanel id="two-step" icon={KeyRound} title="Two-step sign-in" description={`Whether resellers in ${country.name} must use it in SHQ, and how.`}>
              <TwoStepSignIn key={country.code} code={country.code} country={country.name} allowed={country.reseller_two_step_methods} smsProvider={country.sms_provider ?? null} editable={editable} />
            </SettingsPanel>
          </div>
        </div>
      )}
    </AdminShell>
  );
}
