"use client";

import { useParams, useSearchParams } from "next/navigation";
import { PageHeader } from "@bitocard/admin-ui";
import { useStoreDomainsQuery, useStoresQuery } from "@bitocard/api-client/reseller";
import { DomainScreen, WithDomains } from "@/components/domain-pages";
import { ShqShell } from "@/components/shq-shell";

/** Store > Domains > one domain: its connection, DNS records, email and renewal. */
export default function DomainPage() {
  const { id } = useParams<{ id: string }>();
  const wanted = useSearchParams().get("store");
  const stores = useStoresQuery().data?.data ?? [];
  const store = stores.find(item => item.id === wanted) ?? stores[0];
  const name = useStoreDomainsQuery(store?.id ?? "", { skip: !store }).data?.data.find(domain => domain.id === id)?.name;
  return (
    <ShqShell section="store" current="/store/domains" crumbs={[{ label: "Stores", href: "/store" }, { label: "Domains", href: "/store/domains" }, { label: name ?? "Domain" }]}>
      <PageHeader title={name ?? "Domain"} description="Its connection, DNS records, email and renewal." />
      <WithDomains>{(storeRow, domains) => <DomainScreen store={storeRow} domains={domains} id={id} />}</WithDomains>
    </ShqShell>
  );
}
