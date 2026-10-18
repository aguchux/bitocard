"use client";

import { PageHeader } from "@bitocard/admin-ui";
import { BuyDomainScreen, WithDomains } from "@/components/domain-pages";
import { ShqShell } from "@/components/shq-shell";

/** Store > Domains > Buy a domain. */
export default function BuyDomainPage() {
  return (
    <ShqShell section="store" current="/store/domains" crumbs={[{ label: "Store", href: "/store" }, { label: "Domains", href: "/store/domains" }, { label: "Buy a domain" }]}>
      <PageHeader title="Buy a domain" description="Registered in your name, connected to your store with HTTPS, and paid from your wallet." />
      <WithDomains>{(store, domains) => <BuyDomainScreen store={store} domains={domains} />}</WithDomains>
    </ShqShell>
  );
}
