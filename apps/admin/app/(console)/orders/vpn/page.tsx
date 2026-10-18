"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, RefreshCw, ShieldCheck, ShieldEllipsis, Wallet } from "lucide-react";
import { ActionDialog, Badge, Button, Card, CardHeader, DataTable, errorMessage, formatDateTime, formatMoney, formatRelative, Input, Notice, PageHeader, StatCard, StatusBadge, Tabs } from "@bitocard/admin-ui";
import { AdminShell, AppLink, can, useAdmin } from "@bitocard/admin-ui/shell";
import {
  type AdminVpnSubscription,
  useAdminResetVpnPasswordMutation,
  useAdminVpnSubscriptionsQuery,
  useEnableVpnMutation,
  useRunVpnReconciliationMutation,
  useSuspendVpnMutation,
  useSyncVpnMutation,
  useVpnHealthQuery,
  useVpnReconciliationsQuery,
} from "@bitocard/api-client/admin";

const filters = [
  { value: "attention", label: "Needs attention" },
  { value: "active", label: "Active" },
  { value: "provisioning", label: "Provisioning" },
  { value: "expired", label: "Expired" },
  { value: "revoked", label: "Revoked" },
  { value: "suspended", label: "Suspended" },
  { value: "all", label: "All" },
] as const;
type Filter = (typeof filters)[number]["value"];
type Pending = { sub: AdminVpnSubscription; action: "suspend" | "enable" | "reset" };

const statusLabels: Record<string, string> = { needs_review: "Needs review", provisioning: "Provisioning" };

/** Stat cards: what is live, what needs a person, and the supplier's credit from the latest reconciliation. */
function Health() {
  const health = useVpnHealthQuery();
  const data = health.data;
  const latest = data?.reconciliation;
  const credit = latest?.balance_usd_cents ?? null;
  const low = credit !== null && data && (credit < data.low_balance_usd * 100 || (latest?.runway_days !== null && latest!.runway_days! < 7));
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Active" value={data?.live.active ?? 0} icon={<ShieldCheck />} tone="green" loading={health.isLoading} footer={<span className="text-xs text-muted">{`${data?.ending_in_3_days ?? 0} ending in 3 days`}</span>} />
      <StatCard label="Needs attention" value={data?.needs_attention ?? 0} icon={<AlertTriangle />} tone="amber" loading={health.isLoading} footer={<span className="text-xs text-muted">Under review, failed checks or unconfirmed passwords</span>} />
      <StatCard
        label="Supplier credit"
        value={credit === null ? "—" : formatMoney(credit, "USD")}
        icon={<Wallet />}
        tone={low ? "amber" : "blue"}
        loading={health.isLoading}
        footer={<span className="text-xs text-muted">{latest?.runway_days !== null && latest?.runway_days !== undefined ? `About ${Math.floor(latest.runway_days)} days at the current rate` : "From the daily reconciliation"}</span>}
      />
      <StatCard
        label="Billed by the supplier"
        value={latest ? `${latest.supplier_active} / ${latest.expected_active}` : "—"}
        icon={<ShieldEllipsis />}
        tone={latest && latest.supplier_active !== latest.expected_active ? "amber" : "pink"}
        loading={health.isLoading}
        footer={<span className="text-xs text-muted">{latest ? `Active there / active here · ${formatRelative(latest.created_at)}` : "No reconciliation yet"}</span>}
      />
    </div>
  );
}

function Reconciliations() {
  const admin = useAdmin();
  const list = useVpnReconciliationsQuery();
  const [run, state] = useRunVpnReconciliationMutation();
  return (
    <Card>
      <CardHeader
        title="Daily reconciliation"
        description="Every Active account at the supplier against BitoCard's active VPN access, its credit and the credit used since the day before. Ours that should be off are checked again at once."
        actions={
          can(admin, "operations") ? (
            <Button variant="secondary" size="sm" icon={<RefreshCw className="size-4" aria-hidden />} loading={state.isLoading} onClick={() => void run().unwrap().catch(() => undefined)}>
              Run now
            </Button>
          ) : null
        }
      />
      {state.error ? <div className="px-5 sm:px-6"><Notice tone="red">{errorMessage(state.error)}</Notice></div> : null}
      {state.data && "skipped" in state.data ? <div className="px-5 sm:px-6"><Notice tone="amber">The supplier is not set up yet (Settings &gt; Integrations &gt; Suppliers).</Notice></div> : null}
      <DataTable
        caption="Reconciliations"
        rows={list.data?.data}
        loading={list.isLoading}
        error={list.error ? errorMessage(list.error) : null}
        onRetry={list.refetch}
        rowKey={row => row.id}
        empty="No reconciliation has run yet."
        columns={[
          { key: "when", header: "When", cell: row => <span title={formatDateTime(row.created_at)}>{formatRelative(row.created_at)}</span> },
          { key: "credit", header: "Credit", align: "right", cell: row => (row.balance_usd_cents === null ? "—" : formatMoney(row.balance_usd_cents, "USD")) },
          { key: "spent", header: "Used since", align: "right", cell: row => (row.spent_usd_cents === null ? "—" : formatMoney(row.spent_usd_cents, "USD")), hideOnMobile: true },
          { key: "active", header: "Billed / expected", cell: row => `${row.supplier_active} / ${row.expected_active}` },
          {
            key: "findings",
            header: "Findings",
            cell: row => (
              <div className="space-y-1 text-xs">
                {!row.complete ? <Badge tone="amber">Incomplete</Badge> : null}
                {row.unexpected.length ? <p className="text-red-700">{`${row.unexpected.length} billing unexpectedly: ${row.unexpected.slice(0, 3).map(item => item.username).join(", ")}`}</p> : null}
                {row.missing.length ? <p className="text-amber-700">{`${row.missing.length} not active at the supplier`}</p> : null}
                {row.error ? <p className="text-muted">{row.error}</p> : null}
                {row.complete && !row.unexpected.length && !row.missing.length && !row.error ? <span className="text-muted">Matched</span> : null}
              </div>
            ),
          },
        ]}
      />
    </Card>
  );
}

function Subscriptions() {
  const admin = useAdmin();
  const operations = can(admin, "operations");
  const params = useSearchParams();
  const [filter, setFilter] = useState<Filter>(params.get("q") ? "all" : "attention");
  const [q, setQ] = useState(params.get("q") ?? "");
  const status = filter === "all" ? undefined : filter === "attention" ? "needs_review" : filter;
  const query = useAdminVpnSubscriptionsQuery({ ...(status ? { status } : {}), ...(q.trim() ? { q: q.trim() } : {}) });
  const [sync, syncing] = useSyncVpnMutation();
  const [suspend] = useSuspendVpnMutation();
  const [enable] = useEnableVpnMutation();
  const [reset] = useAdminResetVpnPasswordMutation();
  const [pending, setPending] = useState<Pending | null>(null);

  const confirm = async (reason: string) => {
    if (!pending) return;
    if (pending.action === "suspend") await suspend({ id: pending.sub.id, reason }).unwrap();
    if (pending.action === "enable") await enable({ id: pending.sub.id, reason }).unwrap();
    if (pending.action === "reset") await reset({ id: pending.sub.id, reason }).unwrap();
  };

  return (
    <Card>
      <CardHeader title="VPN access" description="Each order's supplier account. BitoCard disables it at its expiry or after a refund, and checks the supplier agrees; nothing here shows a password." />
      <div className="flex flex-col gap-3 px-5 pb-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <Tabs label="Show" variant="pills" value={filter} onChange={setFilter} items={filters.map(item => ({ value: item.value, label: item.label }))} />
        <div className="w-full sm:w-72">
          <label htmlFor="vpn-search" className="sr-only">Search</label>
          <Input id="vpn-search" type="search" placeholder="Order, reseller, account or username" value={q} onChange={event => setQ(event.target.value)} />
        </div>
      </div>
      {syncing.error ? <div className="px-5 pb-4 sm:px-6"><Notice tone="red">{errorMessage(syncing.error)}</Notice></div> : null}
      <DataTable
        caption="VPN access"
        rows={query.data?.data}
        loading={query.isLoading}
        error={query.error ? errorMessage(query.error) : null}
        onRetry={query.refetch}
        rowKey={row => row.id}
        empty={filter === "attention" ? "Nothing needs attention." : "No VPN access."}
        columns={[
          {
            key: "status",
            header: "Status",
            cell: row => (
              <div className="space-y-1">
                <StatusBadge status={row.status} label={statusLabels[row.status]} />
                {row.mode === "test" ? <Badge tone="amber">Sandbox</Badge> : null}
                {row.password_reset_pending ? <Badge tone="amber">Password unconfirmed</Badge> : null}
              </div>
            ),
          },
          {
            key: "order",
            header: "Order",
            cell: row => (
              <div className="space-y-0.5">
                <AppLink href={`/orders/${row.order_id}`} className="font-semibold text-brand-600 hover:underline">
                  View order
                </AppLink>
                <p className="text-xs text-muted">{`Order ${row.order_status ?? "—"}`}</p>
              </div>
            ),
          },
          {
            key: "term",
            header: "Ends",
            cell: row => (
              <div className="space-y-0.5 text-sm">
                <span title={row.expires_at ? formatDateTime(row.expires_at) : undefined}>{row.expires_at ? formatDateTime(row.expires_at) : "—"}</span>
                {row.ended_at ? <p className="text-xs text-muted">{`Stopped ${formatRelative(row.ended_at)}`}</p> : null}
              </div>
            ),
          },
          {
            key: "supplier",
            header: "Supplier",
            hideOnMobile: true,
            cell: row => (
              <div className="space-y-0.5 text-xs">
                <p className="font-mono">{row.supplier_account_id ?? "No account"}</p>
                <p className="text-muted">{`${row.supplier_status ?? "Unknown"} · checked ${row.last_synced_at ? formatRelative(row.last_synced_at) : "never"}`}</p>
                {row.next_sync_at ? <p className="text-muted">{`Next check ${formatRelative(row.next_sync_at)}`}</p> : null}
                {row.last_error ? <p className="text-red-700">{`${row.sync_failures ? `${row.sync_failures} failed checks: ` : ""}${row.last_error}`}</p> : null}
              </div>
            ),
          },
          {
            key: "actions",
            header: "",
            align: "right",
            cell: row =>
              operations ? (
                <div className="flex flex-wrap justify-end gap-2">
                  <Button variant="secondary" size="sm" onClick={() => void sync(row.id).unwrap().catch(() => undefined)}>
                    Check now
                  </Button>
                  {row.status === "active" ? (
                    <Button variant="secondary" size="sm" onClick={() => setPending({ sub: row, action: "reset" })}>
                      Reset password
                    </Button>
                  ) : null}
                  {row.status === "active" || row.status === "needs_review" ? (
                    <Button variant="danger" size="sm" onClick={() => setPending({ sub: row, action: "suspend" })}>
                      Suspend
                    </Button>
                  ) : null}
                  {row.status === "suspended" || row.status === "needs_review" ? (
                    <Button size="sm" onClick={() => setPending({ sub: row, action: "enable" })}>
                      Enable
                    </Button>
                  ) : null}
                </div>
              ) : null,
          },
        ]}
      />
      <ActionDialog
        open={pending !== null}
        onClose={() => setPending(null)}
        title={pending?.action === "suspend" ? "Suspend VPN access" : pending?.action === "enable" ? "Enable VPN access" : "Reset the VPN password"}
        description={
          pending?.action === "suspend"
            ? "The account is disabled with the supplier now. The customer cannot connect until it is enabled again; nothing is refunded."
            : pending?.action === "enable"
              ? "The account is enabled with the supplier and its expiry checked. Only within its paid term."
              : "A new password is set with the supplier. The customer sees it on their order page; you never see it."
        }
        confirmLabel={pending?.action === "suspend" ? "Suspend" : pending?.action === "enable" ? "Enable" : "Reset password"}
        tone={pending?.action === "suspend" ? "danger" : "primary"}
        onConfirm={confirm}
      />
    </Card>
  );
}

/** Orders > VPN access: subscription health, every account with its supplier state, and the daily reconciliation. */
export default function VpnPage() {
  return (
    <AdminShell section="orders" current="/orders/vpn" crumbs={[{ label: "Orders", href: "/orders" }, { label: "VPN access" }]}>
      <PageHeader title="VPN access" description="VPN accounts bill every day they are Active, so BitoCard ends each at its expiry and checks the supplier every day. Never shown to resellers or customers by the supplier's name." />
      <div className="space-y-6">
        <Health />
        <Suspense fallback={null}>
          <Subscriptions />
        </Suspense>
        <Reconciliations />
      </div>
    </AdminShell>
  );
}
