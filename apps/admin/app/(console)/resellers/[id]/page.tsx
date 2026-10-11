"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { Ban, CheckCircle2, ReceiptText, ShieldCheck, ShieldOff } from "lucide-react";
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
import { ResellerWalletsCard } from "@/components/reseller-wallets";
import { StartupAllowanceCard } from "@/components/startup-allowance";
import {
  type ResellerStatus,
  usePlansQuery,
  useRemoveResellerIdentityWaiverMutation,
  useResellerHistoryQuery,
  useResellerQuery,
  useUpdateResellerMutation,
  useVerificationsInfiniteQuery,
  useWaiveResellerIdentityMutation,
} from "@bitocard/api-client/admin";

export default function ResellerPage() {
  const { id } = useParams<{ id: string }>();
  const admin = useAdmin();
  const { data: reseller, error, isFetching, refetch } = useResellerQuery(id);
  const history = useResellerHistoryQuery(id);
  const checks = useVerificationsInfiniteQuery({ reseller_id: id, subject: "reseller" });
  const plans = usePlansQuery();
  const [update, updateState] = useUpdateResellerMutation();
  const [action, setAction] = useState<ResellerStatus | null>(null);
  const [waiver, setWaiver] = useState<"waive" | "remove" | null>(null);
  const [activateNow, setActivateNow] = useState(true);
  const [waive] = useWaiveResellerIdentityMutation();
  const [removeWaiver] = useRemoveResellerIdentityWaiverMutation();
  const operator = can(admin, "operations");

  const latestCheck = checks.data?.pages[0]?.data[0];
  const verified = Boolean(reseller?.verified_at);
  const waived = !verified && Boolean(reseller?.identity_waiver);

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
                    <Button icon={<CheckCircle2 className="size-4" aria-hidden />} onClick={() => setAction("active")} disabled={!verified && !waived}>
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
          {waived && reseller.identity_waiver ? (
            <Notice
              tone="blue"
              title="Identity check waived"
              action={
                operator ? (
                  <Button variant="secondary" size="sm" icon={<ShieldCheck className="size-4" aria-hidden />} onClick={() => setWaiver("remove")}>
                    Ask for the check again
                  </Button>
                ) : null
              }
            >
              {reseller.identity_waiver.waived_by ? `${reseller.identity_waiver.waived_by.name} let` : "An admin let"} this reseller go live without the identity check on{" "}
              {formatDate(reseller.identity_waiver.waived_at)}
              {reseller.identity_waiver.reason ? `: “${reseller.identity_waiver.reason}”.` : "."} Payouts and the startup allowance still need the check.
            </Notice>
          ) : !verified && reseller.status !== "active" ? (
            <Notice
              tone="amber"
              title="Identity not verified"
              action={
                operator ? (
                  <Button variant="secondary" size="sm" icon={<ShieldOff className="size-4" aria-hidden />} onClick={() => setWaiver("waive")}>
                    Don&apos;t ask for ID
                  </Button>
                ) : null
              }
            >
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

          {reseller.country ? <ResellerWalletsCard resellerId={reseller.id} /> : null}
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

          <ActionDialog
            open={waiver === "waive"}
            onClose={() => setWaiver(null)}
            title={`Let ${reseller.name} go live without ID?`}
            description="They can be activated without the owner's identity check: live orders, top-ups and live API keys. Payouts to a bank account and the startup allowance still need the check. Your reason is kept in the audit log."
            confirmLabel="Don't ask for ID"
            onConfirm={reason => waive({ id: reseller.id, reason, activate: reseller.status === "pending" && activateNow }).unwrap()}
          >
            {reseller.status === "pending" ? (
              <label className="flex items-start gap-3 text-sm">
                <input type="checkbox" className="mt-0.5 size-4" checked={activateNow} onChange={event => setActivateNow(event.target.checked)} />
                <span>
                  <span className="block font-semibold text-ink">Activate them now</span>
                  <span className="block text-muted">Otherwise use Activate when you are ready.</span>
                </span>
              </label>
            ) : null}
          </ActionDialog>

          <ActionDialog
            open={waiver === "remove"}
            onClose={() => setWaiver(null)}
            title="Ask for the identity check again?"
            description={
              reseller.status === "active"
                ? "They go back to pending and stop selling live until the owner passes the identity check."
                : "They cannot be activated until the owner passes the identity check."
            }
            confirmLabel="Ask for the check"
            tone="danger"
            onConfirm={reason => removeWaiver({ id: reseller.id, reason }).unwrap()}
          />
        </>
      )}
    </AdminShell>
  );
}
