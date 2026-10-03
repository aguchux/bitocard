"use client";

import { Badge, Card, CardHeader, cn, ErrorState, errorMessage, humanise, Notice, PageHeader, Skeleton } from "@bitocard/admin-ui";
import { type SettingsOption, type SettingsOptionKey, useResellerSettingsQuery, useSetSettingsOptionMutation } from "@bitocard/api-client/reseller";
import { ShqShell } from "@/components/shq-shell";
import { can, useReseller } from "@/components/reseller";

const definitions: Record<SettingsOptionKey, { title: string; description: string; values: Record<string, { label: string; help: string }> }> = {
  gift_card_payout: {
    title: "Gift card sale payouts",
    description: "Where your customers receive the money for gift cards they sell through your store.",
    values: {
      wallet: { label: "To the customer's wallet", help: "Paid into their wallet with your store, ready to spend." },
      bank: { label: "To the customer's bank account", help: "Paid out to a bank account in their name." },
    },
  },
  fixed_price_earning: {
    title: "Earning on face-value products",
    description: "How you earn on airtime, data, pay-TV and bills sold at their face value in your currency.",
    values: {
      markup: { label: "Add a markup", help: "Customers pay face value plus your markup." },
      discount: { label: "Sell at face value", help: "Customers pay face value and you keep BitoCard's discount." },
    },
  },
};

function OptionCard({ optionKey, option, editable }: { optionKey: SettingsOptionKey; option: SettingsOption; editable: boolean }) {
  const [setOption, state] = useSetSettingsOptionMutation();
  const definition = definitions[optionKey] ?? { title: humanise(optionKey), description: "", values: {} };
  const name = `option-${optionKey}`;

  return (
    <Card>
      <CardHeader
        title={definition.title}
        description={definition.description}
        actions={option.allowed.length ? <Badge tone={option.source === "reseller" ? "pink" : "grey"} dot={false}>{option.source === "reseller" ? "Your choice" : "Country default"}</Badge> : null}
      />
      <div className="space-y-3 p-5 sm:p-6">
        {state.error ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
        {option.allowed.length === 0 ? (
          <Notice tone="grey">Not available in your country yet.</Notice>
        ) : (
          <fieldset className="space-y-2" disabled={!editable || state.isLoading}>
            <legend className="sr-only">{definition.title}</legend>
            {option.allowed.map(value => {
              const label = definition.values[value] ?? { label: humanise(value), help: "" };
              const checked = option.value === value;
              return (
                <label
                  key={value}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-xl border p-4 text-sm transition-colors has-[:disabled]:cursor-not-allowed",
                    checked ? "border-brand-500 bg-brand-50" : "border-line hover:bg-canvas",
                  )}
                >
                  <input
                    type="radio"
                    name={name}
                    value={value}
                    checked={checked}
                    onChange={() => setOption({ key: optionKey, value })}
                    className="mt-0.5 size-5 shrink-0 accent-brand-500"
                  />
                  <span className="min-w-0">
                    <span className="block font-semibold text-ink">{label.label}</span>
                    {label.help ? <span className="block text-muted">{label.help}</span> : null}
                  </span>
                </label>
              );
            })}
          </fieldset>
        )}
        {option.allowed.length === 1 ? <p className="text-xs text-muted">This is the only option BitoCard offers in your country at the moment.</p> : null}
      </div>
    </Card>
  );
}

/** The settings chain: BitoCard enables options per country, and the reseller chooses among them. */
export default function PreferencesPage() {
  const { membership } = useReseller();
  const editable = can(membership, "admin");
  const { data, error, isLoading, refetch } = useResellerSettingsQuery();

  return (
    <ShqShell section="settings" current="/settings/preferences" crumbs={[{ label: "Settings", href: "/settings" }, { label: "Preferences" }]}>
      <PageHeader title="Preferences" description="Choose from the options BitoCard offers in your country. If an option is withdrawn, your country's default applies." />
      {!editable ? <Notice tone="grey">Only the owner or an admin can change these preferences.</Notice> : null}
      {!membership.reseller.country ? <Notice tone="amber">Set your business country to see the options available to you.</Notice> : null}
      {error ? (
        <Card>
          <ErrorState message={errorMessage(error, "Could not load your preferences.")} onRetry={refetch} />
        </Card>
      ) : isLoading || !data ? (
        <div className="grid gap-6 lg:grid-cols-2" aria-busy="true" aria-label="Loading preferences">
          <Skeleton className="h-56 w-full" />
          <Skeleton className="h-56 w-full" />
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {(Object.entries(data.options) as Array<[SettingsOptionKey, SettingsOption]>).map(([key, option]) => (
            <OptionCard key={key} optionKey={key} option={option} editable={editable} />
          ))}
        </div>
      )}
    </ShqShell>
  );
}
