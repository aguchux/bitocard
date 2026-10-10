"use client";

import { useState } from "react";
import { Button, Card, CardHeader, errorMessage, Field, Input, Notice, PageHeader, QueryView, Skeleton, StoreCustomersTable, Toggle, useDebouncedValue } from "@bitocard/admin-ui";
import { AdminShell, can, useAdmin } from "@bitocard/admin-ui/shell";
import {
  type CustomerVerificationSettings,
  useCustomerVerificationSettingsQuery,
  useSetCustomerVerificationSettingsMutation,
  useSetStorefrontCustomerCheckMutation,
  useStorefrontCustomersQuery,
} from "@bitocard/api-client/admin";

/**
 * bitocard.com's identity check settings: asked where the market requires it, off for every customer, or asked only
 * once some days have passed since a customer's first purchase (so they can try products first).
 */
function Settings({ settings, editable }: { settings: CustomerVerificationSettings; editable: boolean }) {
  const [save, state] = useSetCustomerVerificationSettingsMutation();
  const [days, setDays] = useState(settings.grace_days === null ? "" : String(settings.grace_days));
  const parsed = days.trim() === "" ? null : Number(days);
  const valid = parsed === null || (Number.isInteger(parsed) && parsed >= 1 && parsed <= 365);
  return (
    <Card>
      <CardHeader
        title="Identity checks on bitocard.com"
        description={settings.enabled ? "Customers are asked where the market requires it for the category." : "No bitocard.com customer is asked."}
        actions={
          <span className="flex items-center gap-2 text-sm font-medium">
            {settings.enabled ? "On" : "Off"}
            <Toggle label="Ask bitocard.com customers for the identity check" checked={settings.enabled} disabled={!editable || state.isLoading} onChange={enabled => save({ enabled })} />
          </span>
        }
      />
      <div className="space-y-4 p-5 sm:p-6">
        {state.error ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={event => {
            event.preventDefault();
            if (valid) void save({ grace_days: parsed });
          }}
        >
          <Field htmlFor="grace-days" label="Ask only after this many days from a customer’s first purchase" hint="Blank: asked before their first purchase. 1 to 365 days.">
            <Input id="grace-days" inputMode="numeric" value={days} disabled={!editable} onChange={event => setDays(event.target.value)} className="w-32" aria-invalid={!valid || undefined} />
          </Field>
          {editable ? (
            <Button type="submit" size="sm" disabled={!valid || parsed === settings.grace_days} loading={state.isLoading}>
              Save
            </Button>
          ) : null}
        </form>
        <p className="text-sm text-muted">
          Which categories need a check is set per market (Settings &gt; Markets), and a supplier’s products can be left out on its card (Catalog &gt; Suppliers). These settings are for
          bitocard.com only: resellers decide for their own stores’ customers.
        </p>
      </div>
    </Card>
  );
}

/** Identity > bitocard.com customers: BitoCard's own store's customers and their identity check settings. */
export default function StorefrontCustomersPage() {
  const admin = useAdmin();
  const editable = can(admin, "operations");
  const [search, setSearch] = useState("");
  const q = useDebouncedValue(search.trim());
  const settings = useCustomerVerificationSettingsQuery();
  const customers = useStorefrontCustomersQuery({ ...(q ? { q } : {}), limit: 100 });
  const [setCheck, state] = useSetStorefrontCustomerCheckMutation();
  return (
    <AdminShell section="verifications" current="/verifications/customers" crumbs={[{ label: "Identity", href: "/verifications" }, { label: "bitocard.com customers" }]}>
      <PageHeader title="bitocard.com customers" description="Who is asked for the identity check on BitoCard’s own store. Turning a check off never marks a customer as checked." />
      <div className="space-y-6">
        <QueryView query={settings} message={error => errorMessage(error)} loading={<Skeleton className="h-48 w-full" />}>
          {data => <Settings key={`${data.enabled}:${data.grace_days}`} settings={data} editable={editable} />}
        </QueryView>
        {state.error ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
        <Card>
          <StoreCustomersTable
            customers={customers.data?.data}
            loading={customers.isLoading}
            error={customers.error ? errorMessage(customers.error) : null}
            onRetry={customers.refetch}
            search={search}
            onSearch={setSearch}
            editable={editable}
            hasMore={customers.data?.has_more}
            onIdentityCheck={(customer, on) => void setCheck({ id: customer.id, identity_check: on })}
          />
        </Card>
      </div>
    </AdminShell>
  );
}
