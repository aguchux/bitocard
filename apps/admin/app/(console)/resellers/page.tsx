"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, DataTable, errorMessage, FilterSelect, formatDate, humanise, PageHeader, StatusBadge, Tabs } from "@bitocard/admin-ui";
import { AdminShell } from "@bitocard/admin-ui/shell";
import { type ResellerStatus, useCountriesQuery, useResellersQuery } from "@bitocard/api-client/admin";

type Filter = "all" | ResellerStatus;

export default function ResellersPage() {
  const router = useRouter();
  const [status, setStatus] = useState<Filter>("all");
  const [country, setCountry] = useState("");
  const countries = useCountriesQuery();
  const { data, error, isLoading, refetch } = useResellersQuery({ status: status === "all" ? undefined : status, country: country || undefined });

  return (
    <AdminShell section="resellers" current="/resellers" crumbs={[{ label: "Resellers", href: "/resellers" }, { label: "All resellers" }]}>
      <PageHeader title="Resellers" description="Businesses selling through BitoCard: their status, plan and country." />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Tabs
          label="Status"
          value={status}
          onChange={setStatus}
          items={[
            { value: "all", label: "All" },
            { value: "pending", label: "Pending" },
            { value: "active", label: "Active" },
            { value: "suspended", label: "Suspended" },
          ]}
        />
        <FilterSelect
          id="country"
          label="Country"
          value={country}
          onChange={setCountry}
          options={[{ value: "", label: "All markets" }, ...(countries.data?.data.map(item => ({ value: item.code, label: item.name })) ?? [])]}
        />
      </div>
      <Card>
        <DataTable
          caption="Resellers"
          rows={data?.data}
          loading={isLoading}
          error={error ? errorMessage(error) : null}
          onRetry={refetch}
          rowKey={reseller => reseller.id}
          onRowClick={reseller => router.push(`/resellers/${reseller.id}`)}
          empty="No resellers match these filters."
          columns={[
            { key: "name", header: "Business", cell: reseller => <span className="font-semibold">{reseller.name}</span> },
            { key: "country", header: "Country", cell: reseller => reseller.country ?? "—" },
            { key: "plan", header: "Plan", cell: reseller => humanise(reseller.plan) },
            { key: "status", header: "Status", cell: reseller => <StatusBadge status={reseller.status} /> },
            { key: "joined", header: "Joined", cell: reseller => <span className="text-muted">{formatDate(reseller.created_at)}</span>, hideOnMobile: true },
          ]}
        />
        {data && data.data.length >= 100 ? <p className="border-t border-line px-6 py-3 text-xs text-muted">Showing the newest 100. Filter by status or country to narrow the list.</p> : null}
      </Card>
    </AdminShell>
  );
}
