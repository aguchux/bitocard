"use client";

import { useState } from "react";
import { ActionDialog, Button, Card, type Column, DataTable, errorMessage, formatRelative, PageHeader, StatusBadge, Tabs } from "@bitocard/admin-ui";
import { AdminShell, AppLink, can, useAdmin } from "@bitocard/admin-ui/shell";
import { type AdminConnection, type ConnectionDecision, type ConnectionStatus, useConnectionsQuery, useDecideConnectionMutation } from "@bitocard/api-client/admin";

const statusLabels: Record<ConnectionStatus, string> = { pending_review: "Waiting for review", active: "Active", rejected: "Rejected", suspended: "Suspended", disconnected: "Disconnected" };

const decisionCopy: Record<ConnectionDecision, { title: string; confirm: string; description: string; danger: boolean; reason: boolean }> = {
  approve: { title: "Approve", confirm: "Approve", description: "The reseller can use this account at once. Check it is theirs and that the provider allows using it through BitoCard.", danger: false, reason: false },
  reject: { title: "Reject", confirm: "Reject", description: "The credentials are erased. The reseller sees your reason and can connect again.", danger: true, reason: true },
  suspend: { title: "Suspend", confirm: "Suspend", description: "The account cannot be used or changed until reinstated. The reseller sees your reason.", danger: true, reason: true },
  reinstate: { title: "Reinstate", confirm: "Reinstate", description: "The account is active again with its saved credentials.", danger: false, reason: false },
};

/** Which decisions each status allows (mirrors the API). */
const allowed: Record<ConnectionStatus, ConnectionDecision[]> = { pending_review: ["approve", "reject", "suspend"], active: ["suspend"], suspended: ["reinstate"], rejected: [], disconnected: [] };

/** Resellers' own supplier and payment gateway connections: review new and changed ones, suspend or reinstate. */
export default function ConnectionsPage() {
  const admin = useAdmin();
  const decides = can(admin, "operations");
  const [status, setStatus] = useState<ConnectionStatus>("pending_review");
  const { data, error, isLoading, refetch } = useConnectionsQuery({ status });
  const [decide] = useDecideConnectionMutation();
  const [pending, setPending] = useState<{ row: AdminConnection; decision: ConnectionDecision } | null>(null);

  const columns: Array<Column<AdminConnection>> = [
    {
      key: "reseller",
      header: "Reseller",
      cell: row => (
        <AppLink href={`/resellers/${row.reseller.id}`} className="font-semibold text-ink hover:underline">
          {row.reseller.name}
        </AppLink>
      ),
    },
    { key: "integration", header: "Integration", cell: row => `${row.integration.name}${row.reseller.country ? ` · ${row.reseller.country}` : ""}` },
    {
      key: "account",
      header: "Account",
      hideOnMobile: true,
      cell: row => {
        const values = Object.entries(row.public_values);
        return values.length ? values.map(([key, value]) => `${key}: ${value}`).join(", ") : "Secrets only";
      },
    },
    {
      key: "check",
      header: "Last check",
      hideOnMobile: true,
      cell: row => (row.last_check ? `${row.last_check.ok === false ? "Failed" : "Passed"} ${formatRelative(row.last_check.checked_at)}` : "None"),
    },
    { key: "status", header: "Status", cell: row => <StatusBadge status={row.status} label={statusLabels[row.status]} /> },
    { key: "updated", header: "Updated", hideOnMobile: true, cell: row => formatRelative(row.updated_at) },
    {
      key: "actions",
      header: "",
      align: "right",
      cell: row =>
        decides ? (
          <div className="flex flex-wrap justify-end gap-2">
            {allowed[row.status].map(decision => (
              <Button key={decision} size="sm" variant={decisionCopy[decision].danger ? "ghost" : "secondary"} onClick={() => setPending({ row, decision })}>
                {decisionCopy[decision].title}
              </Button>
            ))}
          </div>
        ) : null,
    },
  ];

  return (
    <AdminShell section="resellers" current="/resellers/connections" crumbs={[{ label: "Resellers", href: "/resellers" }, { label: "Own integrations" }]}>
      <PageHeader
        title="Resellers' own integrations"
        description="Live connections to resellers' own supplier and payment gateway accounts. Secrets are never shown; the account details are what the reseller entered that is not secret."
      />
      <Tabs
        label="Connection status"
        value={status}
        onChange={setStatus}
        items={(["pending_review", "active", "suspended", "rejected"] as const).map(value => ({ value, label: statusLabels[value] }))}
      />
      <Card>
        <DataTable
          columns={columns}
          rows={data?.data}
          rowKey={row => row.id}
          loading={isLoading}
          error={error ? errorMessage(error) : null}
          onRetry={refetch}
          empty={status === "pending_review" ? "Nothing waiting for review." : "No connections here."}
          caption="Resellers' own integrations"
        />
      </Card>
      {pending ? (
        <ActionDialog
          open
          onClose={() => setPending(null)}
          title={`${decisionCopy[pending.decision].title} ${pending.row.reseller.name}'s ${pending.row.integration.name} account?`}
          description={decisionCopy[pending.decision].description}
          confirmLabel={decisionCopy[pending.decision].confirm}
          tone={decisionCopy[pending.decision].danger ? "danger" : "primary"}
          requireReason={decisionCopy[pending.decision].reason}
          onConfirm={reason => decide({ id: pending.row.id, decision: pending.decision, reason: reason || undefined }).unwrap()}
        />
      ) : null}
    </AdminShell>
  );
}
