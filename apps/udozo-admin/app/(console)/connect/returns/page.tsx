"use client";

import { useState } from "react";
import { ActionDialog, Badge, Button, Card, DataTable, errorMessage, FilterSelect, formatDateTime, PageHeader, type Column } from "@bitocard/admin-ui";
import { can, useAdmin } from "@bitocard/admin-ui/shell";
import { type ConnectReturn, useApproveConnectReturnMutation, useConnectReturnsQuery } from "@bitocard/api-client/admin";
import { MarketFilter } from "@/components/classifieds";
import { money } from "@/components/connect";
import { UdozoShell } from "@/components/shell";

const reasonLabels: Record<ConnectReturn["reason"], string> = { not_collected: "Not collected in time", refused_at_check_in: "Refused at check-in", refused_at_counter: "Refused at the counter", damaged: "Damaged" };
const statusLabels: Record<ConnectReturn["status"], string> = { requested: "Waiting for an answer", accepted: "Accepted: the seller collects it", collected: "Collected", cancelled: "Cancelled" };
const statusTones: Record<ConnectReturn["status"], "amber" | "blue" | "green" | "grey"> = { requested: "amber", accepted: "blue", collected: "green", cancelled: "grey" };
const decidedLabels = { seller: "by the seller", admin: "by Udozo", auto: "by itself: nobody answered" } as const;

/**
 * Connect > Returns: every Connect Centre's returns to sellers, newest first. Operations approve a waiting one at any
 * time (it is accepted by itself when neither the seller nor Udozo answers in time).
 */
export default function ConnectReturnsPage() {
  const admin = useAdmin();
  const [country, setCountry] = useState("");
  const [status, setStatus] = useState<ConnectReturn["status"] | "">("requested");
  const [approving, setApproving] = useState<ConnectReturn | null>(null);
  const returns = useConnectReturnsQuery({ country: country || undefined, status: status || undefined });
  const [approve] = useApproveConnectReturnMutation();
  const operations = can(admin, "operations");

  const columns: Array<Column<ConnectReturn>> = [
    {
      key: "item",
      header: "Item",
      cell: row => (
        <span className="block min-w-0">
          <span className="block truncate font-semibold text-ink">{row.order.title}</span>
          <span className="block truncate text-xs text-muted">
            {row.number} · {row.order.number} · {row.centre.name}
          </span>
        </span>
      ),
    },
    {
      key: "reason",
      header: "Why",
      hideOnMobile: true,
      cell: row => (
        <span className="block text-sm">
          <span className="block text-ink">{reasonLabels[row.reason]}</span>
          <span className="block text-xs text-muted">For {row.seller.name}</span>
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: row => (
        <span className="grid gap-1">
          <Badge tone={statusTones[row.status]}>{statusLabels[row.status]}</Badge>
          <span className="text-xs text-muted">
            {row.status === "requested"
              ? `Accepted by itself ${formatDateTime(row.answer_by)}`
              : row.decided_by
                ? `${decidedLabels[row.decided_by]}${row.return_fee !== null ? ` · fee ${money(row.return_fee, row.currency)}` : ""}`
                : ""}
          </span>
        </span>
      ),
    },
    {
      key: "act",
      header: "",
      align: "right",
      cell: row =>
        operations && row.status === "requested" ? (
          <Button size="sm" variant="secondary" onClick={() => setApproving(row)}>
            Approve
          </Button>
        ) : null,
    },
  ];

  return (
    <UdozoShell section="connect" current="/connect/returns" crumbs={[{ label: "Connect", href: "/connect/applications" }, { label: "Returns" }]}>
      <PageHeader title="Returns" description="Items Connect Centres are returning to their sellers. The seller accepts, or Udozo approves; unanswered, a return is accepted by itself and everyone is told." />
      <div className="mt-6 flex flex-wrap items-end gap-3">
        <MarketFilter id="returns-market" value={country} onChange={setCountry} />
        <FilterSelect
          id="returns-status"
          label="Status"
          value={status}
          onChange={value => setStatus(value as ConnectReturn["status"] | "")}
          options={[{ value: "", label: "All" }, ...(Object.keys(statusLabels) as Array<ConnectReturn["status"]>).map(value => ({ value, label: statusLabels[value] }))]}
        />
      </div>
      <Card className="mt-4">
        <DataTable<ConnectReturn>
          caption="Returns to sellers"
          columns={columns}
          rows={returns.data?.data}
          loading={returns.isLoading}
          error={returns.error ? errorMessage(returns.error) : null}
          onRetry={returns.refetch}
          rowKey={row => row.id}
          empty="No returns here."
        />
      </Card>
      {approving ? (
        <ActionDialog
          open
          onClose={() => setApproving(null)}
          title={`Approve return ${approving.number}?`}
          description={`${approving.centre.name} returns "${approving.order.title}" to ${approving.seller.name}, who collects it with their return code. An item not collected is settled now: the buyer gets the price back.`}
          confirmLabel="Approve return"
          requireReason={false}
          onConfirm={async () => void (await approve({ id: approving.id }).unwrap())}
        />
      ) : null}
    </UdozoShell>
  );
}
