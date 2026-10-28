"use client";

import { ArrowUpFromLine, Flag, Gavel } from "lucide-react";
import { PageHeader, StatCard } from "@bitocard/admin-ui";
import { AppLink, useAdmin } from "@bitocard/admin-ui/shell";
import { useCryptoWithdrawalsQuery } from "@bitocard/api-client/admin";
import { useP2pOrdersQuery, useP2pReportsQuery } from "@bitocard/api-client/afrippa-admin";
import { AfrippaShell } from "@/components/shell";

/** Afrippa's admin home: what is waiting for a person (appeals, reports, withdrawals to approve), each linking to its queue. */
export default function OverviewPage() {
  const admin = useAdmin();
  const appeals = useP2pOrdersQuery({ mode: "live", status: "appealed", limit: 100 });
  const reports = useP2pReportsQuery({ status: "open", mode: "live" });
  const withdrawals = useCryptoWithdrawalsQuery({ mode: "live", status: "review" });
  const count = (list: { data?: { data: unknown[] } }) => list.data?.data.length ?? "…";
  return (
    <AfrippaShell section="home" current="/" crumbs={[{ label: "Dashboard" }]}>
      <PageHeader title={`Hello, ${admin.name.split(/\s+/)[0]}`} description="What is waiting for Afrippa's team, live." />
      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <AppLink href="/orders" className="block">
          <StatCard label="Appeals to decide" value={count(appeals)} icon={<Gavel />} loading={appeals.isLoading} />
        </AppLink>
        <AppLink href="/reports" className="block">
          <StatCard label="Open reports" value={count(reports)} icon={<Flag />} tone="amber" loading={reports.isLoading} />
        </AppLink>
        <AppLink href="/crypto/withdrawals" className="block">
          <StatCard label="Withdrawals to approve" value={count(withdrawals)} icon={<ArrowUpFromLine />} tone="blue" loading={withdrawals.isLoading} />
        </AppLink>
      </div>
    </AfrippaShell>
  );
}
