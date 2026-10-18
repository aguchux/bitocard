"use client";

import { useParams } from "next/navigation";
import { ScanFace } from "lucide-react";
import { errorMessage, PageHeader, QueryView, Skeleton, StoreCustomerView } from "@bitocard/admin-ui";
import { AppLink } from "@bitocard/admin-ui/shell";
import {
  type Store,
  useSignOutStoreCustomerMutation,
  useStoreCustomerQuery,
  useStoresQuery,
  useUnlockStoreCustomerMutation,
  useUpdateStoreCustomerMutation,
} from "@bitocard/api-client/reseller";
import { ShqShell } from "@/components/shq-shell";
import { WithStore } from "@/components/store-templates";
import { can, useReseller } from "@/components/reseller";

/**
 * BitoCard Verify's review console, where a registered, KYB-verified business reviews its own customers' ID checks.
 * Shown only when the API says this customer's case is the store's to review; otherwise nothing about documents.
 */
const reviewUrl = (id: string) => `${(process.env.NEXT_PUBLIC_VERIFY_URL ?? "https://verify.bitocard.com").replace(/\/+$/, "")}/review/${encodeURIComponent(id)}`;

function Customer({ store, id }: { store: Store; id: string }) {
  const { membership } = useReseller();
  const manage = can(membership, "admin");
  const customer = useStoreCustomerQuery({ storeId: store.id, id });
  const [update, updateState] = useUpdateStoreCustomerMutation();
  const [unlock, unlockState] = useUnlockStoreCustomerMutation();
  const [signOut, signOutState] = useSignOutStoreCustomerMutation();
  const failed = updateState.error ?? unlockState.error ?? signOutState.error;
  return (
    <>
      <PageHeader title={customer.data?.name ?? "Customer"} description={`A customer of ${store.name}.`} />
      <QueryView query={customer} message={error => errorMessage(error)} loading={<Skeleton className="h-96 w-full" />}>
        {data => (
          <StoreCustomerView
            customer={data}
            canChange={manage}
            canUnlock={manage}
            busy={updateState.isLoading || unlockState.isLoading || signOutState.isLoading}
            error={failed ? errorMessage(failed) : null}
            storeChecksOff={!store.customer_verification}
            identityReview={
              data.identity_case?.reviewable ? (
                <a href={reviewUrl(data.identity_case.id)} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-line px-4 text-sm font-semibold text-brand-600 hover:bg-canvas">
                  <ScanFace className="size-4" aria-hidden />
                  Review ID
                </a>
              ) : null
            }
            onUpdate={change => void update({ storeId: store.id, id, ...change })}
            onUnlock={() => void unlock({ storeId: store.id, id })}
            onSignOut={() => void signOut({ storeId: store.id, id })}
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
    </>
  );
}

/** One of the store's customers: account, identity check and purchases. */
export default function StoreCustomerPage() {
  const { id } = useParams<{ id: string }>();
  const stores = useStoresQuery();
  return (
    <ShqShell section="store" current="/store/customers" crumbs={[{ label: "Store", href: "/store" }, { label: "Customers", href: "/store/customers" }, { label: "Customer" }]}>
      <QueryView query={stores} message={error => errorMessage(error, "Could not load your store.")} loading={<Skeleton className="h-96 w-full" />}>
        {({ data }) => (
          <WithStore stores={data} empty={null}>
            {store => <Customer key={store.id} store={store} id={id} />}
          </WithStore>
        )}
      </QueryView>
    </ShqShell>
  );
}
