"use client";

import { PageHeader } from "@bitocard/admin-ui";
import { ConnectDomainScreen, WithDomains } from "@/components/domain-pages";
import { ShqShell } from "@/components/shq-shell";

/** Store > Domains > Connect a domain. */
export default function ConnectDomainPage() {
  return (
    <ShqShell section="store" current="/store/domains" crumbs={[{ label: "Stores", href: "/store" }, { label: "Domains", href: "/store/domains" }, { label: "Connect a domain" }]}>
      <PageHeader title="Connect a domain" description="Use a domain you already own, from any registrar." />
      <WithDomains>{(store, domains) => <ConnectDomainScreen store={store} domains={domains} />}</WithDomains>
    </ShqShell>
  );
}
