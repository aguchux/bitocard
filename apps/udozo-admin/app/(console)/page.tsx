"use client";

import { useState } from "react";
import { ArrowRight, Flag, ListChecks, MessageSquareWarning, ShieldCheck, Store, Users, Wallet } from "lucide-react";
import { Card, CardHeader, cn, errorMessage, formatMoney, formatNumber, RefreshFailed, StatCard } from "@bitocard/admin-ui";
import { AppLink, useAdmin, useMode } from "@bitocard/admin-ui/shell";
import { ModeSwitch, UdozoShell } from "@/components/shell";
import { useClassifiedDisputesQuery, useClassifiedQueueQuery, useClassifiedReportsQuery, useOverviewQuery, useResaleStoreReportsQuery } from "@bitocard/api-client/admin";

function greeting(hour: number) {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/** The overview of admin.udozo.com: what needs a person now, then the marketplace's and resellers' figures. */
export default function OverviewPage() {
  const admin = useAdmin();
  const { mode } = useMode();
  const overview = useOverviewQuery({ days: 30, mode });
  const queue = useClassifiedQueueQuery();
  const reports = useClassifiedReportsQuery({ status: "open" });
  const disputes = useClassifiedDisputesQuery({ status: "open" });
  const storeReports = useResaleStoreReportsQuery({ status: "open" });
  // The hour is only known in the browser; the page is client-rendered behind the session check.
  const [hour] = useState(() => new Date().getHours());
  const data = overview.data;

  const attention = [
    { count: queue.data?.stats.waiting ?? 0, label: "ads waiting for review", href: "/classifieds", icon: ListChecks },
    { count: reports.data?.data.length ?? 0, label: "open reports", href: "/classifieds/reports", icon: Flag },
    { count: disputes.data?.data.length ?? 0, label: "Safe pay disputes to decide", href: "/classifieds/disputes", icon: MessageSquareWarning },
    { count: storeReports.data?.data.length ?? 0, label: "store reports to decide", href: "/classifieds/resale-reports", icon: Store },
    { count: data?.attention.verifications_in_review ?? 0, label: "identity checks to decide", href: "/verifications", icon: ShieldCheck },
  ].filter(item => item.count > 0);

  return (
    <UdozoShell section="home" current="/" crumbs={[{ label: "Dashboard", href: "/" }, { label: "Overview" }]} actions={<ModeSwitch />}>
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
          {greeting(hour)}, {admin.name.split(" ")[0]}
        </h1>
        <p className="mt-1 text-lg text-muted">Here’s what’s happening across Udozo’s marketplace and resellers.</p>
      </div>

      {overview.error && !overview.isFetching && data ? <RefreshFailed message={errorMessage(overview.error, "Could not refresh the overview.")} onRetry={overview.refetch} /> : null}

      <Card>
        <CardHeader title="Needs attention" description="Work waiting for a person, oldest first on each page." />
        <div className="px-5 pb-5 sm:px-6">
          {attention.length ? (
            <ul className="flex flex-wrap gap-3" aria-label="Needs attention">
              {attention.map(item => (
                <li key={item.href}>
                  <AppLink href={item.href} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 text-sm font-medium text-amber-900 hover:bg-amber-100">
                    <item.icon className="size-4" aria-hidden />
                    <span className="font-bold">{item.count}</span> {item.label}
                    <ArrowRight className="size-4" aria-hidden />
                  </AppLink>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">Nothing is waiting: the moderation queue, reports, disputes and identity checks are clear.</p>
          )}
        </div>
      </Card>

      <div className={cn("grid gap-4 sm:grid-cols-2 xl:grid-cols-4", overview.isFetching && !overview.isLoading && "opacity-70 transition-opacity")}>
        <StatCard
          loading={queue.isLoading}
          label="Approved today"
          icon={<ListChecks />}
          tone="pink"
          value={formatNumber(queue.data?.stats.approved_today ?? 0)}
          footer={<p className="text-xs text-muted">{`${queue.data?.stats.sent_back_today ?? 0} sent back · ${queue.data?.stats.removed_today ?? 0} removed`}</p>}
        />
        <StatCard
          loading={overview.isLoading}
          label="Active resellers"
          icon={<Users />}
          tone="green"
          value={formatNumber(data?.resellers.active ?? 0)}
          footer={<p className="text-xs text-muted">{`${data?.resellers.joined ?? 0} joined in 30 days · ${data?.resellers.pending ?? 0} pending`}</p>}
        />
        <StatCard
          loading={overview.isLoading}
          label="Wallet float"
          icon={<Wallet />}
          tone="violet"
          value={formatMoney(data?.usd.wallet_float ?? 0, "USD")}
          footer={<p className="text-xs text-muted">Held for sellers and resellers, all markets in USD</p>}
        />
        <StatCard
          loading={overview.isLoading}
          label="Identity checks"
          icon={<ShieldCheck />}
          tone="blue"
          value={formatNumber(data?.attention.verifications_in_review ?? 0)}
          footer={<p className="text-xs text-muted">Waiting for a decision</p>}
        />
      </div>
      {mode === "test" ? <p className="text-sm text-muted">Showing sandbox figures for resellers and wallets.</p> : null}
    </UdozoShell>
  );
}
