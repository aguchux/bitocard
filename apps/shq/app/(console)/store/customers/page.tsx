"use client";

import { useState } from "react";
import { Store as StoreIcon } from "lucide-react";
import { Card, EmptyState, errorMessage, Notice, PageHeader, QueryView, Skeleton, StoreCustomersTable, useDebouncedValue } from "@bitocard/admin-ui";
import { type Store, useSetStoreCustomerCheckMutation, useStoreCustomersQuery, useStoresQuery } from "@bitocard/api-client/reseller";
import { ShqShell } from "@/components/shq-shell";
import { can, useReseller } from "@/components/reseller";

function Customers({ store, canManage }: { store: Store; canManage: boolean }) {
  const [search, setSearch] = useState("");
  const q = useDebouncedValue(search.trim());
  const customers = useStoreCustomersQuery({ storeId: store.id, ...(q ? { q } : {}), limit: 100 });
  const [setCheck, state] = useSetStoreCustomerCheckMutation();
  return (
    <div className="space-y-4">
      {!store.customer_verification ? <Notice tone="amber">Identity checks are off for your whole store (Store &gt; Customer identity checks), so no customer is asked whatever is set here.</Notice> : null}
      {state.error ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
      <Card>
        <StoreCustomersTable
          customers={customers.data?.data}
          loading={customers.isLoading}
          error={customers.error ? errorMessage(customers.error) : null}
          onRetry={customers.refetch}
          search={search}
          onSearch={setSearch}
          editable={canManage}
          hasMore={customers.data?.has_more}
          onIdentityCheck={(customer, on) => void setCheck({ storeId: store.id, id: customer.id, identity_check: on })}
        />
      </Card>
    </div>
  );
}

/** The store's customers, and whether each is asked for BitoCard's identity check. */
export default function StoreCustomersPage() {
  const { membership } = useReseller();
  const stores = useStoresQuery();
  return (
    <ShqShell section="store" current="/store/customers" crumbs={[{ label: "Store", href: "/store" }, { label: "Customers" }]}>
      <PageHeader
        title="Customers"
        description="Everyone with an account at your store. Turn the identity check off for a customer and they are no longer asked; it never marks them as checked."
      />
      <QueryView query={stores} message={error => errorMessage(error, "Could not load your store.")} loading={<Skeleton className="h-72 w-full" />}>
        {({ data: [store] }) =>
          store ? (
            <Customers key={store.id} store={store} canManage={can(membership, "admin")} />
          ) : (
            <Card>
              <EmptyState title="No store yet" icon={<StoreIcon className="size-6" aria-hidden />}>
                Customers sign up at your store once it is created and published.
              </EmptyState>
            </Card>
          )
        }
      </QueryView>
    </ShqShell>
  );
}
