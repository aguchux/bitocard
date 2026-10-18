"use client";

import { PageHeader } from "@bitocard/admin-ui";
import { DomainsOverview, WithDomains } from "@/components/domain-pages";
import { ShqShell } from "@/components/shq-shell";

/** Store > Domains: the store's domains at a glance, and the list; buying, connecting and each domain have their own pages. */
export default function StoreDomainsPage() {
  return (
    <ShqShell section="store" current="/store/domains" crumbs={[{ label: "Store", href: "/store" }, { label: "Domains" }]}>
      <PageHeader title="Domains" description="Your store on your own addresses: how each domain is doing, what needs your attention and what renews next." />
      <WithDomains>{(store, domains) => <DomainsOverview store={store} domains={domains} />}</WithDomains>
    </ShqShell>
  );
}
