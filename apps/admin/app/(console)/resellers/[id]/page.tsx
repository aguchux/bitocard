"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { Ban, CheckCircle2, ReceiptText, RotateCcw, ShieldCheck } from "lucide-react";
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
  Badge,
  Notice,
  PageHeader,
  PhoneContact,
  RefreshFailed,
  Skeleton,
  StatusBadge,
} from "@bitocard/admin-ui";
import { AdminShell, can, useAdmin, AppLink } from "@bitocard/admin-ui/shell";
import { MakeCustomerCard } from "@/components/account-switch";
import { ResellerEmailsCard } from "@/components/reseller-emails";
import { ResellerSwitchesCard } from "@/components/reseller-switches";
import { CancelCheck, cancellable } from "@/components/verification-list";
import { ResellerWalletsCard } from "@/components/reseller-wallets";
import { StartupAllowanceCard } from "@/components/startup-allowance";
import { StoreLimit } from "@/components/store-limit";
import { TestAccount } from "@/components/test-account";
import {
  type ResellerStatus,
  useUnsuspendResellerMutation,
  useResetMemberTwoStepMutation,
  useResellerHistoryQuery,
  useResellerQuery,
  useUpdateResellerMutation,
  useVerificationsInfiniteQuery,
} from "@bitocard/api-client/admin";

const twoStepNames = { authenticator: "app", email: "email", sms: "SMS" } as const;

export default function ResellerPage() {
  const { id } = useParams<{ id: string }>();
  const admin = useAdmin();
  const { data: reseller, error, isFetching, refetch } = useResellerQuery(id);
  const history = useResellerHistoryQuery(id);
  const checks = useVerificationsInfiniteQuery({ reseller_id: id, subject: "reseller" });
  const [update, updateState] = useUpdateResellerMutation();
  const [action, setAction] = useState<ResellerStatus | null>(null);
  const [unsuspend] = useUnsuspendResellerMutation();
  const [lifting, setLifting] = useState(false);
  const [resetting, setResetting] = useState<{ user_id: string; name: string } | null>(null);
  const [resetTwoStep] = useResetMemberTwoStepMutation();
  const operator = can(admin, "operations");

  const latestCheck = checks.data?.pages[0]?.data[0];
  const verified = Boolean(reseller?.verified_at);
  const testAccount = Boolean(reseller?.test_account);

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
                  {reseller.status === "suspended" ? (
                    <Button icon={<RotateCcw className="size-4" aria-hidden />} onClick={() => setLifting(true)}>
                      Unsuspend
                    </Button>
                  ) : reseller.status !== "active" ? (
                    <Button icon={<CheckCircle2 className="size-4" aria-hidden />} onClick={() => setAction("active")} disabled={!verified && !testAccount}>
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
          <TestAccount reseller={reseller} operator={operator} latestCheck={latestCheck?.status} />

          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader title="Account" />
              <div className="p-5 sm:p-6">
                <KeyValue
                  items={[
                    { label: "Status", value: <StatusBadge status={reseller.status} /> },
                    { label: "Stores", value: <StoreLimit reseller={reseller} operator={operator} /> },
                    { label: "Country", value: reseller.country ?? "—" },
                    {
                      label: "Phone at sign-up",
                      value: reseller.signup_phone ? (
                        <span className="inline-flex flex-wrap items-center gap-2">
                          <PhoneContact phone={reseller.signup_phone} />
                          <Badge tone="grey">Not confirmed</Badge>
                        </span>
                      ) : (
                        "—"
                      ),
                    },
                    ...(reseller.account_type
                      ? [
                          {
                            label: "Sells as",
                            value: (
                              <span className="inline-flex flex-wrap items-center gap-2">
                                {reseller.account_type === "business" ? "Business" : "Individual"}
                                {reseller.account_type === "business" ? <Badge tone={reseller.verified_business ? "green" : "amber"}>{reseller.verified_business ? "Business verified" : "Business not verified"}</Badge> : null}
                                {reseller.paused_for_kyb ? <Badge tone="amber">Paused for business check</Badge> : null}
                              </span>
                            ),
                          },
                        ]
                      : []),
                    ...(reseller.business_profile?.legal_name ? [{ label: "Legal name", value: reseller.business_profile.legal_name }] : []),
                    ...(reseller.business_profile?.address ? [{ label: "Address", value: reseller.business_profile.address }] : []),
                    ...(reseller.business_profile?.phone ? [{ label: "Business telephone", value: <PhoneContact phone={reseller.business_profile.phone.replace(/[^\d+]/g, "")} /> }] : []),
                    ...(reseller.business_profile?.description ? [{ label: "What it does", value: <span className="whitespace-pre-line">{reseller.business_profile.description}</span> }] : []),
                    ...(reseller.verified_business ? [{ label: "Verified business", value: `${reseller.verified_business.registered_name ?? "—"} · ${reseller.verified_business.registration_number ?? "—"}` }] : []),
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
                    {latestCheck.reason ? <p className="text-sm text-ink">{humanise(latestCheck.reason)}</p> : null}
                    {operator && cancellable(latestCheck) ? (
                      <div className="pt-2">
                        <CancelCheck check={latestCheck} />
                        <p className="mt-2 text-xs text-muted">Closes the unfinished check so the owner can start again. Checks with no progress for three days close on their own.</p>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <p className="text-sm text-muted">The owner has not started the identity check.</p>
                )}
              </div>
            </Card>
          </div>

          {can(admin, "operations", "support") ? <ResellerEmailsCard resellerId={reseller.id} /> : null}

          {can(admin, "operations", "support") ? <MakeCustomerCard resellerId={reseller.id} canChange={operator} /> : null}

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader title="Team" />
              <ul className="divide-y divide-line px-5 pb-3 sm:px-6">
                {reseller.members.map(member => (
                  <li key={member.user_id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{member.name}</p>
                      <p className="truncate text-xs text-muted">{member.email ?? "—"}</p>
                      {member.phone ? <PhoneContact phone={member.phone} className="mt-1 text-xs" /> : null}
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                      {member.two_step !== undefined ? <Badge tone={member.two_step ? "green" : "grey"}>{member.two_step ? `Two-step: ${twoStepNames[member.two_step]}` : "Two-step off"}</Badge> : null}
                      <span className="text-sm text-muted">{humanise(member.role)}</span>
                      {operator && member.two_step ? (
                        <Button variant="ghost" size="sm" onClick={() => setResetting({ user_id: member.user_id, name: member.name })}>
                          Reset two-step
                        </Button>
                      ) : null}
                    </div>
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

          {reseller.country ? <ResellerWalletsCard resellerId={reseller.id} resellerName={reseller.name} /> : null}
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
            open={resetting !== null}
            onClose={() => setResetting(null)}
            title={`Reset ${resetting?.name ?? "this person"}'s two-step sign-in?`}
            description="For someone who lost their phone or email access, once you are sure it is them. Two-step sign-in is turned off and they are signed out everywhere; where their account requires it, they set it up again at their next sign-in. They are emailed, and your reason is kept in the audit log."
            confirmLabel="Reset two-step"
            tone="danger"
            onConfirm={reason => resetTwoStep({ id: reseller.id, user: resetting!.user_id, reason }).unwrap()}
          />

          <ActionDialog
            open={lifting}
            onClose={() => setLifting(false)}
            title={`Unsuspend ${reseller.name}?`}
            description={
              verified || testAccount
                ? "They are active again: live orders, their store and their API keys work again. Your reason is kept in the audit log and the team is told."
                : "Their identity check is not done, so they go back to pending and finish it before taking live orders. Your reason is kept in the audit log and the team is told."
            }
            confirmLabel="Unsuspend"
            onConfirm={reason => unsuspend({ id: reseller.id, reason }).unwrap()}
          />
        </>
      )}
    </AdminShell>
  );
}
