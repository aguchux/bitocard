"use client";

import { Globe } from "lucide-react";
import { EmptyState, errorMessage, Notice, PageHeader, QueryView, Skeleton } from "@bitocard/admin-ui";
import { AppLink } from "@bitocard/admin-ui/shell";
import { type Store, useStoreDomainsQuery, useStoresQuery } from "@bitocard/api-client/reseller";
import { BuyDomain, ConnectDomain, DomainCard } from "@/components/domains";
import { ShqShell } from "@/components/shq-shell";
import { can, useReseller } from "@/components/reseller";

function Domains({ store }: { store: Store }) {
  const { user, membership, mode } = useReseller();
  const manage = can(membership, "admin");
  const owner = membership.role === "owner";
  const domains = useStoreDomainsQuery(store.id);
  const [first, ...rest] = user.name.trim().split(/\s+/);
  return (
    <QueryView
      query={domains}
      loading={<Skeleton className="h-64 w-full" />}
      message={error => errorMessage(error, "Could not load your domains.")}
    >
      {data => (
        <div className="space-y-6">
          {data.data.length ? (
            data.data.map(domain => <DomainCard key={domain.id} store={store.id} domain={domain} owner={owner} canManage={manage} />)
          ) : (
            <EmptyState title="No domains yet" icon={<Globe className="size-6" aria-hidden />}>
              Your store is at {store.url}. Buy a domain or connect one you own to use your own address.
            </EmptyState>
          )}
          {manage && data.data.filter(domain => !["removed", "failed"].includes(domain.status)).length < data.max_domains ? (
            <div className="grid gap-6 xl:grid-cols-2">
              <BuyDomain
                store={store.id}
                available={data.buying.available}
                tlds={data.buying.tlds}
                live={mode === "live"}
                contactDefaults={{ first_name: first ?? "", last_name: rest.join(" "), email: user.email, phone: user.phone ?? "", country: membership.reseller.country ?? "", company_name: membership.reseller.name }}
              />
              <ConnectDomain store={store.id} />
            </div>
          ) : null}
          {!manage ? <Notice tone="blue">The owner or an admin of {membership.reseller.name} manages the store’s domains.</Notice> : null}
        </div>
      )}
    </QueryView>
  );
}

/** Store > Domains: buy a .com or connect a domain, its DNS, email setup and renewals. */
export default function StoreDomainsPage() {
  const stores = useStoresQuery();
  return (
    <ShqShell section="store" current="/store/domains" crumbs={[{ label: "Store", href: "/store" }, { label: "Domains" }]}>
      <PageHeader title="Domains" description="Your store on your own address: buy a domain here or connect one you own, manage its DNS and set up email." />
      <QueryView query={stores} loading={<Skeleton className="h-64 w-full" />} message={error => errorMessage(error, "Could not load your store.")}>
        {({ data: [store] }) =>
          store ? (
            <Domains key={store.id} store={store} />
          ) : (
            <Notice tone="blue">
              Create your store first: <AppLink href="/store" className="font-semibold text-brand-600 hover:underline">Store</AppLink>.
            </Notice>
          )
        }
      </QueryView>
    </ShqShell>
  );
}
