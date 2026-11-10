"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Card, DataTable, errorMessage, FilterSelect, formatDate, formatNumber, PageHeader, type Column } from "@bitocard/admin-ui";
import { usePrefetchQuery } from "@bitocard/api-client";
import { type ConnectCentre, useConnectCentresQuery } from "@bitocard/api-client/admin";
import { MarketFilter } from "@/components/classifieds";
import { centreStatusLabels as statusLabels, centreStatusTones as statusTones, money, pausedBy } from "@/components/connect";
import { UdozoShell } from "@/components/shell";

/** Connect > Centres: the Connect Centres approved applications made, newest first; each opens its own page. */
export default function ConnectCentresPage() {
  const router = useRouter();
  const prefetch = usePrefetchQuery("connectCentre");
  const [country, setCountry] = useState("");
  const [status, setStatus] = useState<ConnectCentre["status"] | "">("");
  const centres = useConnectCentresQuery({ country: country || undefined, status: status || undefined });

  const columns: Array<Column<ConnectCentre>> = [
    {
      key: "centre",
      header: "Centre",
      cell: row => (
        <span className="block min-w-0">
          <span className="block truncate font-semibold text-brand-600">{row.name}</span>
          <span className="block truncate text-xs text-muted">
            {row.number} · {row.area}, {row.state}
          </span>
        </span>
      ),
    },
    {
      key: "partner",
      header: "Partner",
      hideOnMobile: true,
      cell: row => (
        <span className="block min-w-0">
          <span className="block truncate font-medium text-ink">{row.partner.name}</span>
          <span className="block truncate text-xs text-muted">{row.partner.email}</span>
        </span>
      ),
    },
    {
      key: "capacity",
      header: "Capacity",
      align: "right",
      hideOnMobile: true,
      cell: row => (
        <span className="block whitespace-nowrap text-sm">
          <span className="block text-ink">{formatNumber(row.capacity)} items</span>
          <span className="block text-xs text-muted">Deposit {money(row.deposit.amount, row.deposit.currency)}</span>
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: row => (
        <span className="grid gap-1">
          <Badge tone={statusTones[row.status]}>{statusLabels[row.status]}</Badge>
          <span className="text-xs text-muted">{row.paused ? pausedBy(row.paused) : `Since ${formatDate(row.created_at)}`}</span>
        </span>
      ),
    },
  ];

  return (
    <UdozoShell section="connect" current="/connect/centres" crumbs={[{ label: "Connect", href: "/connect/applications" }, { label: "Centres" }]}>
      <PageHeader title="Connect Centres" description="Offices approved to receive, check and hand over items, run by their partners on connect.udozo.com. Open one to see its people and storage places, or to pause or close it." />
      <div className="mt-6 flex flex-wrap items-end gap-3">
        <MarketFilter id="centres-market" value={country} onChange={setCountry} />
        <FilterSelect
          id="centres-status"
          label="Status"
          value={status}
          onChange={value => setStatus(value as ConnectCentre["status"] | "")}
          options={[{ value: "", label: "All" }, ...(Object.keys(statusLabels) as Array<ConnectCentre["status"]>).map(value => ({ value, label: statusLabels[value] }))]}
        />
      </div>
      <Card className="mt-4">
        <DataTable<ConnectCentre>
          caption="Connect Centres"
          columns={columns}
          rows={centres.data?.data}
          loading={centres.isLoading}
          error={centres.error ? errorMessage(centres.error) : null}
          onRetry={centres.refetch}
          rowKey={row => row.id}
          onRowClick={row => router.push(`/connect/centres/${row.id}`)}
          onRowIntent={row => {
            router.prefetch(`/connect/centres/${row.id}`);
            prefetch(row.id);
          }}
          empty="No centres yet. Approving an application makes one."
        />
      </Card>
    </UdozoShell>
  );
}
