"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, errorMessage, Notice, PageHeader, StoreCustomersTable, useDebouncedValue } from "@bitocard/admin-ui";
import { can, useAdmin } from "@bitocard/admin-ui/shell";
import { UdozoShell } from "@/components/shell";
import { useStorefrontCustomersQuery, useStorefrontSettingsQuery, useUpdateStorefrontCustomerMutation } from "@bitocard/api-client/admin";

/** Marketplace > Accounts: every Udozo account (one account works on udozo.com and on every reseller store). */
export default function UdozoAccountsPage() {
  const admin = useAdmin();
  const router = useRouter();
  const editable = can(admin, "operations");
  const [search, setSearch] = useState("");
  const q = useDebouncedValue(search.trim());
  const customers = useStorefrontCustomersQuery({ ...(q ? { q } : {}), limit: 100 });
  const settings = useStorefrontSettingsQuery();
  const [update, state] = useUpdateStorefrontCustomerMutation();
  return (
    <UdozoShell section="marketplace" current="/customers" crumbs={[{ label: "Marketplace", href: "/classifieds" }, { label: "Accounts" }]}>
      <PageHeader title="Accounts" description="Everyone with a Udozo account: the same account on udozo.com and on every reseller store. Open one for their account and wallet; turning a check off never marks them as checked." />
      <div className="space-y-4">
        {settings.data && !settings.data.customer_verification ? (
          <Notice tone="amber">
            Identity checks are off for every Udozo account, so nobody is asked whatever is set here.
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
            onOpen={customer => router.push(`/customers/${customer.id}`)}
          />
        </Card>
      </div>
    </UdozoShell>
  );
}
