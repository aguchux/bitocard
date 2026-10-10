"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { Ban, CheckCircle2, ReceiptText, ShieldCheck } from "lucide-react";
import {
  ActionDialog,
  Button,
  Card,
  CardHeader,
  DataTable,
  ErrorState,
  errorMessage,
  formatDate,
  formatDateTime,
  humanise,
  KeyValue,
  Notice,
  PageHeader,
  RefreshFailed,
  Select,
  Skeleton,
  StatusBadge,
} from "@bitocard/admin-ui";
import { AdminShell, can, useAdmin, AppLink } from "@bitocard/admin-ui/shell";
import { ResellerSwitchesCard } from "@/components/reseller-switches";
import { StartupAllowanceCard } from "@/components/startup-allowance";
import { type ResellerStatus, usePlansQuery, useResellerHistoryQuery, useResellerQuery, useUpdateResellerMutation, useVerificationsInfiniteQuery } from "@bitocard/api-client/admin";

export default function ResellerPage() {
  const { id } = useParams<{ id: string }>();
  const admin = useAdmin();
  const { data: reseller, error, isFetching, refetch } = useResellerQuery(id);
  const history = useResellerHistoryQuery(id);
  const checks = useVerificationsInfiniteQuery({ reseller_id: id, subject: "reseller" });
  const plans = usePlansQuery();
  const [update, updateState] = useUpdateResellerMutation();
  const [action, setAction] = useState<ResellerStatus | null>(null);
  const operator = can(admin, "operations");

  const latestCheck = checks.data?.pages[0]?.data[0];
  const verified = Boolean(reseller?.verified_at);

  return (
    <AdminShell section="resellers" current="/resellers" crumbs={[{ label: "Resellers", href: "/resellers" }, { label: reseller?.name ?? "Reseller" }]}>
      {!reseller && error ? (
        <Card>
          <ErrorState message={errorMessage(error, "Could not load this reseller.")} onRetry={refetch} />
        </Card>
      ) : !reseller ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <>
          {error && !isFetching ? <RefreshFailed message={errorMessage(error, "Could not refresh this reseller.")} onRetry={refetch} /> : null}
          <PageHeader
            title={reseller.name}
            description={`${reseller.country ?? "No country yet"} · joined ${formatDate(reseller.created_at)}`}
            actions={
              operator ? (
                <>
                  <AppLink href={`/orders?reseller=${reseller.id}`} className="inline-flex min-h-11 items-center gap-2 rounded-xl px-4 text-sm font-semibold text-muted hover:bg-white hover:text-ink">
                    <ReceiptText className="size-4" aria-hidden />
                    Orders
                  </AppLink>
                  {reseller.status !== "active" ? (
                    <Button icon={<CheckCircle2 className="size-4" aria-hidden />} onClick={() => setAction("active")} disabled={!verified}>
                      Activate
                    </Button>
                  ) : null}
                  {reseller.status !== "suspended" ? (
                    <Button variant="danger" icon={<Ban className="size-4" aria-hidden />} onClick={() => setAction("suspended")}>
                      Suspend
                    </Button>
                  ) : null}
                </>
              ) : null
            }
          />
          {!verified && reseller.status !== "active" ? (
            <Notice tone="amber" title="Identity not verified">
              The owner has not passed the identity check, so this reseller cannot go live yet.
              {latestCheck ? ` Latest check: ${humanise(latestCheck.status)}.` : " No check started."}
            </Notice>
          ) : null}

          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader title="Account" />
              <div className="p-5 sm:p-6">
                <KeyValue
                  items={[
                    { label: "Status", value: <StatusBadge status={reseller.status} /> },
                    {
                      label: "Plan",
                      value: operator ? (
                        <Select
                          aria-label="Plan"
                          value={reseller.plan.code}
                          disabled={updateState.isLoading}
                          onChange={event => update({ id: reseller.id, plan: event.target.value })}
                          className="max-w-48"
                        >
                          {(plans.data?.data ?? [reseller.plan]).map(plan => (
                            <option key={plan.code} value={plan.code}>
                              {plan.name}
                            </option>
                          ))}
                        </Select>
                      ) : (
                        reseller.plan.name
                      ),
                    },
                    { label: "Country", value: reseller.country ?? "—" },
                    { label: "Reseller ID", value: <code className="font-mono text-xs">{reseller.id}</code> },
                  ]}
                />
                {updateState.error ? (
                  <div className="mt-4">
                    <Notice tone="red">{errorMessage(updateState.error)}</Notice>
                  </div>
                ) : null}
              </div>
            </Card>

            <Card>
              <CardHeader
                title="Identity check"
                actions={
                  <AppLink href="/verifications/all" className="text-sm font-semibold text-blue-600 hover:underline">
                    All checks
                  </AppLink>
                }
              />
              <div className="space-y-2 p-5 sm:p-6">
                {latestCheck ? (
                  <>
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="size-5 text-muted" aria-hidden />
                      <StatusBadge status={latestCheck.status} />
                    </div>
                    <p className="text-sm text-muted">{`Started ${formatDateTime(latestCheck.created_at)}${latestCheck.verified_name ? ` · verified as ${latestCheck.verified_name}` : ""}`}</p>
                    {latestCheck.reason ? <p className="text-sm text-ink">{latestCheck.reason}</p> : null}
                  </>
                ) : (
                  <p className="text-sm text-muted">The owner has not started the identity check.</p>
                )}
              </div>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader title="Team" />
              <ul className="divide-y divide-line px-5 pb-3 sm:px-6">
                {reseller.members.map(member => (
                  <li key={member.user_id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{member.name}</p>
                      <p className="truncate text-xs text-muted">{member.email ?? "—"}</p>
                    </div>
                    <span className="text-sm text-muted">{humanise(member.role)}</span>
                  </li>
                ))}
              </ul>
            </Card>
            <Card>
              <CardHeader title="Stores" />
              <ul className="divide-y divide-line px-5 pb-3 sm:px-6">
                {reseller.stores.map(store => (
                  <li key={store.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{store.name}</p>
                      <p className="truncate text-xs text-muted">{`${store.subdomain}.bitocard.com`}</p>
                    </div>
                    <StatusBadge status={store.status} />
                  </li>
                ))}
                {!reseller.stores.length ? <li className="py-4 text-sm text-muted">No store yet.</li> : null}
              </ul>
            </Card>
          </div>

          <StartupAllowanceCard resellerId={reseller.id} verified={Boolean(reseller.verified_at)} switchedOn={Boolean(reseller.features.startup_allowance)} />

          <ResellerSwitchesCard resellerId={reseller.id} features={reseller.features} />

          <Card>
            <CardHeader title="History" description="Admin changes to this reseller." />
            <div className="mt-4">
              <DataTable
                caption="History"
                rows={history.data?.data}
                loading={history.isLoading}
                rowKey={entry => `${entry.action}-${entry.created_at}`}
                empty="No admin changes yet."
                columns={[
                  { key: "action", header: "Change", cell: entry => humanise(entry.action) },
                  { key: "when", header: "When", cell: entry => <span className="text-muted">{formatDateTime(entry.created_at)}</span> },
                ]}
              />
            </div>
          </Card>

          <ActionDialog
            open={action !== null}
            onClose={() => setAction(null)}
            title={action === "active" ? `Activate ${reseller.name}?` : `Suspend ${reseller.name}?`}
            description={
              action === "active"
                ? "They can take live orders and top up their wallet."
                : "Every API key stops working at once and their store goes offline until you activate them again."
            }
            confirmLabel={action === "active" ? "Activate" : "Suspend"}
            tone={action === "suspended" ? "danger" : "primary"}
            requireReason={false}
            onConfirm={() => update({ id: reseller.id, status: action! }).unwrap()}
          />
        </>
      )}
    </AdminShell>
  );
}
