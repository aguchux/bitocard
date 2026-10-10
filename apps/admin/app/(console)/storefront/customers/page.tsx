"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, errorMessage, Notice, PageHeader, StoreCustomersTable, useDebouncedValue } from "@bitocard/admin-ui";
import { AdminShell, AppLink, can, useAdmin } from "@bitocard/admin-ui/shell";
import { useStorefrontCustomersQuery, useStorefrontSettingsQuery, useUpdateStorefrontCustomerMutation } from "@bitocard/api-client/admin";

/** Storefront > Customers: bitocard.com's own customers. Resellers manage their stores' customers in SHQ. */
export default function StorefrontCustomersPage() {
  const admin = useAdmin();
  const router = useRouter();
  const editable = can(admin, "operations");
  const [search, setSearch] = useState("");
  const q = useDebouncedValue(search.trim());
  const customers = useStorefrontCustomersQuery({ ...(q ? { q } : {}), limit: 100 });
  const settings = useStorefrontSettingsQuery();
  const [update, state] = useUpdateStorefrontCustomerMutation();
  return (
    <AdminShell section="storefront" current="/storefront/customers" crumbs={[{ label: "Storefront", href: "/storefront" }, { label: "Customers" }]}>
      <PageHeader title="Customers" description="Everyone with an account on bitocard.com. Open a customer for their purchases and account; turning a check off never marks them as checked." />
      <div className="space-y-4">
        {settings.data && !settings.data.customer_verification ? (
          <Notice tone="amber">
            Identity checks are off for every bitocard.com customer (
            <AppLink href="/storefront/settings" className="font-semibold underline">
              Storefront settings
            </AppLink>
            ), so nobody is asked whatever is set here.
          </Notice>
        ) : null}
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
            onIdentityCheck={(customer, on) => void update({ id: customer.id, identity_check: on })}
            onOpen={customer => router.push(`/storefront/customers/${customer.id}`)}
          />
        </Card>
      </div>
    </AdminShell>
  );
}
