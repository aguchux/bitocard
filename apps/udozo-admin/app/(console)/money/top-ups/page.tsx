"use client";

import { useState } from "react";
import { Badge, Card, DataTable, errorMessage, FilterSelect, formatDateTime, formatMoney, PageHeader, type Column, type Tone } from "@bitocard/admin-ui";
import { AppLink } from "@bitocard/admin-ui/shell";
import { UdozoShell } from "@/components/shell";
import { type ManualTopUp, type ManualTopUpStatus, useManualTopUpsQuery } from "@bitocard/api-client/admin";

const tones: Record<ManualTopUpStatus, Tone> = { awaiting_code: "amber", expired: "grey", completed: "green", cancelled: "grey" };
const labels: Record<ManualTopUpStatus, string> = { awaiting_code: "Waiting for the code", expired: "Code expired", completed: "Credited", cancelled: "Cancelled" };

const columns: Array<Column<ManualTopUp>> = [
  {
    key: "top_up",
    header: "Top-up",
    cell: topUp => (
      <span className="block">
        <span className="block font-semibold text-ink">
          {formatMoney(topUp.amount, topUp.currency)}
          {topUp.mode === "test" ? <span className="font-normal text-muted"> · sandbox</span> : null}
        </span>
        <span className="block text-xs text-muted">{`${topUp.number} · ${formatDateTime(topUp.completed_at ?? topUp.created_at)}`}</span>
      </span>
    ),
  },
  {
    key: "wallet",
    header: "Wallet",
    cell: topUp => (
      <AppLink href={topUp.target.type === "reseller" ? `/resellers/${topUp.target.id}` : `/customers/${topUp.target.id}`} className="text-brand-600 hover:underline">
        {topUp.target.name}
        <span className="block text-xs text-muted">{topUp.target.type === "reseller" ? "Reseller" : (topUp.target.email ?? "Account")}</span>
      </AppLink>
    ),
  },
  {
    key: "source",
    header: "Source",
    hideOnMobile: true,
    cell: topUp => (
      <span className="block text-sm">
        {topUp.source === "received" ? `Received${topUp.external_reference ? ` (${topUp.external_reference})` : ""}` : "Goodwill"}
        <span className="block text-xs text-muted">{`${topUp.requested_by.name ?? "Admin"}: ${topUp.reason}`}</span>
      </span>
    ),
  },
  { key: "status", header: "Status", cell: topUp => <Badge tone={tones[topUp.status]}>{labels[topUp.status]}</Badge> },
];

type Filter = "" | "awaiting_code" | "completed" | "cancelled";

/**
 * Money > Manual top-ups: the latest wallet top-ups finance made by hand (money received outside the gateways, or
 * goodwill). Each is started from a reseller's or an account's page and confirmed with a code.
 */
export default function ManualTopUpsPage() {
  const [status, setStatus] = useState<Filter>("");
  const topUps = useManualTopUpsQuery(status ? { status } : {});
  return (
    <UdozoShell section="money" current="/money/top-ups" crumbs={[{ label: "Money", href: "/money/payouts" }, { label: "Manual top-ups" }]}>
      <PageHeader title="Manual top-ups" description="Wallets topped up by hand: money Udozo received outside its gateways, or goodwill. Finance starts one from a reseller's or an account's page." />
      <div className="mt-6 flex flex-wrap gap-3">
        <FilterSelect
          id="top-ups-status"
          label="Status"
          value={status}
          onChange={value => setStatus(value as Filter)}
          options={[
            { value: "", label: "All" },
            { value: "awaiting_code", label: "Waiting for the code" },
            { value: "completed", label: "Credited" },
            { value: "cancelled", label: "Cancelled" },
          ]}
        />
      </div>
      <Card className="mt-4">
        <DataTable
          caption="Manual top-ups"
          columns={columns}
          rows={topUps.data?.data}
          rowKey={topUp => topUp.id}
          loading={topUps.isLoading}
          error={topUps.error ? errorMessage(topUps.error) : null}
          onRetry={topUps.refetch}
          empty="No manual top-ups yet."
        />
      </Card>
    </UdozoShell>
  );
}
