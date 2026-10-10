"use client";

import { useParams } from "next/navigation";
import { errorMessage, PageHeader, QueryView, Skeleton, StoreCustomerView } from "@bitocard/admin-ui";
import { AdminShell, AppLink, can, useAdmin } from "@bitocard/admin-ui/shell";
import {
  useSignOutStorefrontCustomerMutation,
  useStorefrontCustomerQuery,
  useStorefrontSettingsQuery,
  useUnlockStorefrontCustomerMutation,
  useUpdateStorefrontCustomerMutation,
} from "@bitocard/api-client/admin";

/** One bitocard.com customer: account, identity check and purchases, with operations' and support's actions (audited). */
export default function StorefrontCustomerPage() {
  const { id } = useParams<{ id: string }>();
  const admin = useAdmin();
  const customer = useStorefrontCustomerQuery(id);
  const settings = useStorefrontSettingsQuery();
  const [update, updateState] = useUpdateStorefrontCustomerMutation();
  const [unlock, unlockState] = useUnlockStorefrontCustomerMutation();
  const [signOut, signOutState] = useSignOutStorefrontCustomerMutation();
  const failed = updateState.error ?? unlockState.error ?? signOutState.error;
  return (
    <AdminShell
      section="storefront"
      current="/storefront/customers"
      crumbs={[{ label: "Storefront", href: "/storefront" }, { label: "Customers", href: "/storefront/customers" }, { label: customer.data?.name ?? "Customer" }]}
    >
      <PageHeader title={customer.data?.name ?? "Customer"} description="A bitocard.com customer." />
      <QueryView query={customer} message={error => errorMessage(error)} loading={<Skeleton className="h-96 w-full" />}>
        {data => (
          <StoreCustomerView
            customer={data}
            canChange={can(admin, "operations")}
            canUnlock={can(admin, "operations", "support")}
            busy={updateState.isLoading || unlockState.isLoading || signOutState.isLoading}
            error={failed ? errorMessage(failed) : null}
            storeChecksOff={settings.data ? !settings.data.customer_verification : false}
            onUpdate={change => void update({ id, ...change })}
            onUnlock={() => void unlock(id)}
            onSignOut={() => void signOut(id)}
            orderLink={purchase =>
              purchase.order_id ? (
                <AppLink href={`/orders/${purchase.order_id}`} className="font-semibold text-brand-600 hover:underline">
                  View order
                </AppLink>
              ) : (
                "—"
              )
            }
          />
        )}
      </QueryView>
    </AdminShell>
  );
}
