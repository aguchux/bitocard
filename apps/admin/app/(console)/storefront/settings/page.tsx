"use client";

import { useState } from "react";
import { Button, Card, CardHeader, errorMessage, Field, Input, KeyValue, Notice, PageHeader, QueryView, Select, Skeleton, Toggle } from "@bitocard/admin-ui";
import { AdminShell, AppLink, can, useAdmin } from "@bitocard/admin-ui/shell";
import { type StorefrontSettings, useSetStorefrontSettingsMutation, useStorefrontSettingsQuery } from "@bitocard/api-client/admin";

const navLabels = { rail: "Side rail", bottom: "Bottom bar" } as const;

/**
 * Identity checks on bitocard.com: asked where the market requires it, off for every customer, or asked only once some
 * days have passed since a customer's first purchase (so they can try products first).
 */
function IdentityChecks({ settings, editable }: { settings: StorefrontSettings; editable: boolean }) {
  const [save, state] = useSetStorefrontSettingsMutation();
  const [days, setDays] = useState(settings.grace_days === null ? "" : String(settings.grace_days));
  const parsed = days.trim() === "" ? null : Number(days);
  const valid = parsed === null || (Number.isInteger(parsed) && parsed >= 1 && parsed <= 365);
  return (
    <Card>
      <CardHeader
        title="Customer identity checks"
        description={settings.customer_verification ? "Customers are asked where the market requires it for the category." : "No bitocard.com customer is asked."}
        actions={
          <span className="flex items-center gap-2 text-sm font-medium">
            {settings.customer_verification ? "On" : "Off"}
            <Toggle
              label="Ask bitocard.com customers for the identity check"
              checked={settings.customer_verification}
              disabled={!editable || state.isLoading}
              onChange={customer_verification => save({ customer_verification })}
            />
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
          Which categories need a check is set per market (Settings &gt; Markets); a supplier’s products can be left out on its card (Catalog &gt; Suppliers), and one customer on their page (
          <AppLink href="/storefront/customers" className="font-semibold text-brand-600 hover:underline">
            Customers
          </AppLink>
          ). These settings are for bitocard.com only: resellers decide for their own stores’ customers.
        </p>
      </div>
    </Card>
  );
}

/** The customer account app's menu on desktop for bitocard.com; phones and tablets always use the bottom bar. */
function DesktopMenu({ settings, editable }: { settings: StorefrontSettings; editable: boolean }) {
  const [save, state] = useSetStorefrontSettingsMutation();
  return (
    <Card>
      <CardHeader title="Customer account app" description={`On desktop, customers see the ${navLabels[settings.desktop_nav_effective].toLowerCase()}.`} />
      <div className="space-y-4 p-5 sm:p-6">
        {state.error ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
        <Field htmlFor="desktop-nav" label="Menu on desktop" hint="Follow the feature switch (Settings > Feature switches), or choose one for bitocard.com.">
          <Select
            id="desktop-nav"
            value={settings.desktop_nav ?? ""}
            disabled={!editable || state.isLoading}
            onChange={event => save({ desktop_nav: (event.target.value || null) as StorefrontSettings["desktop_nav"] })}
          >
            <option value="">Follow the feature switch</option>
            <option value="rail">Side rail</option>
            <option value="bottom">Bottom bar</option>
          </Select>
        </Field>
      </div>
    </Card>
  );
}

/** Storefront > Settings: bitocard.com's own store settings. */
export default function StorefrontSettingsPage() {
  const admin = useAdmin();
  const editable = can(admin, "operations");
  const settings = useStorefrontSettingsQuery();
  return (
    <AdminShell section="storefront" current="/storefront/settings" crumbs={[{ label: "Storefront", href: "/storefront" }, { label: "Settings" }]}>
      <PageHeader title="Store settings" description="How bitocard.com treats its customers. Resellers set the same for their own stores in SHQ." />
      <QueryView query={settings} message={error => errorMessage(error)} loading={<Skeleton className="h-96 w-full" />}>
        {data => (
          <div className="grid gap-6 xl:grid-cols-2">
            <IdentityChecks key={`checks:${data.grace_days}`} settings={data} editable={editable} />
            <div className="space-y-6">
              <DesktopMenu settings={data} editable={editable} />
              <Card>
                <CardHeader title="Checkout" description={data.checkout_mode === "live" ? "Customers pay real money." : "Sandbox: payments and orders are simulated."} />
                <div className="space-y-3 p-5 sm:p-6 text-sm text-muted">
                  <KeyValue items={[{ label: "Mode", value: data.checkout_mode === "live" ? "Live" : "Sandbox" }]} />
                  <p>
                    Set by the Customer checkout integration’s Sandbox switch (Settings &gt; Integrations). Payment methods per market are in Settings &gt; Markets.
                  </p>
                </div>
              </Card>
            </div>
          </div>
        )}
      </QueryView>
    </AdminShell>
  );
}
