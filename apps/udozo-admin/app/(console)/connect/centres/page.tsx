"use client";

import { useState } from "react";
import { Badge, Card, DataTable, errorMessage, FilterSelect, formatDate, formatNumber, PageHeader, type Column } from "@bitocard/admin-ui";
import { AppLink } from "@bitocard/admin-ui/shell";
import { type ConnectCentre, useConnectCentresQuery } from "@bitocard/api-client/admin";
import { MarketFilter } from "@/components/classifieds";
import { money } from "@/components/connect";
import { UdozoShell } from "@/components/shell";

const statusLabels: Record<ConnectCentre["status"], string> = { active: "Active", paused: "Paused", closed: "Closed" };
const statusTones: Record<ConnectCentre["status"], "green" | "amber" | "grey"> = { active: "green", paused: "amber", closed: "grey" };

/** Connect > Centres: the Connect Centres approved applications made, newest first, each with the application it came from. */
export default function ConnectCentresPage() {
  const [country, setCountry] = useState("");
  const [status, setStatus] = useState<ConnectCentre["status"] | "">("");
  const centres = useConnectCentresQuery({ country: country || undefined, status: status || undefined });

  const columns: Array<Column<ConnectCentre>> = [
    {
      key: "centre",
      header: "Centre",
      cell: row => (
        <span className="block min-w-0">
          {row.application_id ? (
            <AppLink href={`/connect/applications/${row.application_id}`} className="block truncate font-semibold text-brand-600 hover:underline">
              {row.name}
            </AppLink>
          ) : (
            <span className="block truncate font-semibold text-ink">{row.name}</span>
          )}
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
          <span className="text-xs text-muted">Since {formatDate(row.created_at)}</span>
        </span>
      ),
    },
  ];

  return (
    <UdozoShell section="connect" current="/connect/centres" crumbs={[{ label: "Connect", href: "/connect/applications" }, { label: "Centres" }]}>
      <PageHeader title="Connect Centres" description="Offices approved to receive, check and hand over items. Running them on connect.udozo.com comes with the next phase." />
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
          empty="No centres yet. Approving an application makes one."
        />
      </Card>
    </UdozoShell>
  );
}
