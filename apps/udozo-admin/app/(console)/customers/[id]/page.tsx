"use client";

import { useParams } from "next/navigation";
import { Card, CardHeader, errorMessage, PageHeader, QueryView, Skeleton, StoreCustomerView } from "@bitocard/admin-ui";
import { AppLink, can, useAdmin } from "@bitocard/admin-ui/shell";
import { UdozoShell } from "@/components/shell";
import {
  useSignOutStorefrontCustomerMutation,
  useStorefrontCustomerQuery,
  useStorefrontSettingsQuery,
  useUnlockStorefrontCustomerMutation,
  useUpdateStorefrontCustomerMutation,
} from "@bitocard/api-client/admin";
import { WalletTopUp } from "@/components/wallet-top-up";

/** The customer's two wallets: their country's currency (named once they have held it) and US dollars. */
function customerWallets(wallet: Array<{ currency: string }>) {
  const local = wallet.find(item => item.currency !== "USD")?.currency ?? null;
  return [
    { code: null, currency: local ?? "", label: local ? `${local} (their country)` : "Their country's currency" },
    { code: "USD", currency: "USD", label: "US dollars" },
  ];
}

/** One Udozo account: account, identity check and wallet, with operations' and support's actions (audited). */
export default function UdozoAccountPage() {
  const { id } = useParams<{ id: string }>();
  const admin = useAdmin();
  const customer = useStorefrontCustomerQuery(id);
  const settings = useStorefrontSettingsQuery();
  const [update, updateState] = useUpdateStorefrontCustomerMutation();
  const [unlock, unlockState] = useUnlockStorefrontCustomerMutation();
  const [signOut, signOutState] = useSignOutStorefrontCustomerMutation();
  const failed = updateState.error ?? unlockState.error ?? signOutState.error;
  return (
    <UdozoShell
      section="marketplace"
      current="/customers"
      crumbs={[{ label: "Marketplace", href: "/classifieds" }, { label: "Accounts", href: "/customers" }, { label: customer.data?.name ?? "Account" }]}
    >
      <PageHeader title={customer.data?.name ?? "Account"} description="A Udozo account, used on udozo.com and every reseller store." />
      <QueryView query={customer} message={error => errorMessage(error)} loading={<Skeleton className="h-96 w-full" />}>
        {data => (
          <div className="space-y-6">
          <StoreCustomerView
            customer={data}
            canChange={can(admin, "operations")}
            canUnlock={can(admin, "operations", "support")}
            busy={updateState.isLoading || unlockState.isLoading || signOutState.isLoading}
            error={failed ? errorMessage(failed) : null}
            storeChecksOff={settings.data ? !settings.data.customer_verification : false}
            identityReview={
              data.identity_case ? (
                <AppLink href={`/verifications/verify/${data.identity_case.id}`} className="text-sm font-semibold text-brand-600 hover:underline">
                  Open the Udozo Verify case
                </AppLink>
              ) : null
            }
            onUpdate={change => void update({ id, ...change })}
            onUnlock={() => void unlock(id)}
            onSignOut={() => void signOut(id)}
            orderLink={() => "—"}
          />
          <Card>
            <CardHeader title="Wallet top-ups" description="Money added by Udozo by hand. Spend only: it is never withdrawn." />
            <div className="px-5 pb-5 sm:px-6">
              <WalletTopUp
                target={{ type: "customer", id }}
                targetName={data.name}
                currencies={customerWallets(data.wallet)}
                modeNote="The wallet is topped up in the store's own mode (live, or the sandbox while checkout is in sandbox): the only one the customer sees."
              />
            </div>
          </Card>
          </div>
        )}
      </QueryView>
    </UdozoShell>
  );
}
