"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Card, DataTable, errorMessage, Input, PageHeader, useDebouncedValue, type Column } from "@bitocard/admin-ui";
import { AfrippaShell as AdminShell } from "@/components/shell";
import { type CryptoCustomer, useCryptoCustomersQuery } from "@bitocard/api-client/admin";
import { usePrefetchQuery } from "@bitocard/api-client";

const columns: Array<Column<CryptoCustomer>> = [
  {
    key: "customer",
    header: "Customer",
    cell: customer => (
      <span className="block min-w-0">
        <span className="block truncate font-semibold text-ink">{customer.email}</span>
        <span className="block text-xs text-muted">{customer.name}</span>
      </span>
    ),
  },
  { key: "nickname", header: "Market name", cell: customer => customer.nickname ?? "—" },
  { key: "store", header: "Store", cell: customer => customer.store.name, hideOnMobile: true },
  { key: "country", header: "Country", cell: customer => customer.country ?? "—", hideOnMobile: true },
  { key: "status", header: "Crypto account", cell: customer => (customer.frozen ? <Badge tone="red">Frozen</Badge> : <Badge tone="green">Active</Badge>) },
];

/**
 * Crypto > Wallets & freezes: find a trader (by email or ID; with no search, those holding crypto) and
 * open them to see their balances, freeze or release crypto, or freeze the whole crypto account.
 */
export default function CryptoCustomersPage() {
  const router = useRouter();
  // Opening a row draws at once: its page's code and data are fetched as the pointer reaches it.
  const prefetchDetail = usePrefetchQuery("cryptoCustomer");
  const [search, setSearch] = useState("");
  const q = useDebouncedValue(search.trim());
  const customers = useCryptoCustomersQuery(q ? { q } : {});
  return (
    <AdminShell section="crypto" current="/crypto" crumbs={[{ label: "Crypto", href: "/crypto" }, { label: "Wallets & freezes" }]}>
      <PageHeader title="Wallets & freezes" description="Traders' crypto wallets. Freeze an amount or a whole crypto account while you look into it; every change is audited." />
      <Card className="mt-6">
        <div className="border-b border-line p-4">
          <label htmlFor="crypto-search" className="sr-only">
            Search customers
          </label>
          <Input id="crypto-search" type="search" placeholder="Search by email or customer ID" value={search} onChange={event => setSearch(event.target.value)} />
        </div>
        <DataTable
          columns={columns}
          rows={customers.data?.data}
          rowKey={customer => customer.id}
          loading={customers.isLoading}
          error={customers.error ? errorMessage(customers.error) : null}
          onRetry={customers.refetch}
          empty={q ? "No customer matches." : "No customer holds crypto yet."}
          onRowClick={customer => router.push(`/crypto/customers/${customer.id}`)}
          onRowIntent={customer => { router.prefetch(`/crypto/customers/${customer.id}`); prefetchDetail(customer.id); }}
        />
      </Card>
    </AdminShell>
  );
}
