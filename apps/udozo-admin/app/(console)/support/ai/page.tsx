"use client";

import { Building2, Cpu, DollarSign } from "lucide-react";
import { Card, DataTable, errorMessage, PageHeader, StatCard } from "@bitocard/admin-ui";
import { AppLink } from "@bitocard/admin-ui/shell";
import { UdozoShell } from "@/components/shell";
import { type AiUsageRow, useAdminAiUsageQuery } from "@bitocard/api-client/admin";

const usd = (value: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);

/** AI use by support assistants this month: on Udozo's keys (its cost) and on resellers' own. */
export default function AdminAiUsagePage() {
  const query = useAdminAiUsageQuery();
  const rows = query.data?.data ?? [];
  const bitocard = rows.filter(row => row.funding === "bitocard");
  return (
    <UdozoShell section="assistants" current="/support/ai" crumbs={[{ label: "Support", href: "/support" }, { label: "AI usage" }]}>
      <PageHeader title="AI usage" description="Support assistants’ AI calls this month. Udozo pays for its own keys (Settings > Integrations: Anthropic, OpenAI, DeepSeek, Support assistant); stores on their own keys pay their provider." />
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard icon={<DollarSign aria-hidden />} label="Udozo’s cost" value={usd(bitocard.reduce((sum, row) => sum + row.cost_usd, 0))} />
        <StatCard icon={<Cpu aria-hidden />} tone="violet" label="Calls on Udozo’s keys" value={bitocard.reduce((sum, row) => sum + row.calls, 0).toLocaleString("en-GB")} />
        <StatCard icon={<Building2 aria-hidden />} tone="blue" label="Calls on resellers’ keys" value={rows.filter(row => row.funding === "own").reduce((sum, row) => sum + row.calls, 0).toLocaleString("en-GB")} />
      </div>
      <Card>
        <DataTable<AiUsageRow>
          caption="AI usage"
          rows={query.isLoading ? undefined : rows}
          loading={query.isLoading}
          error={query.error ? errorMessage(query.error) : null}
          onRetry={query.refetch}
          rowKey={row => `${row.reseller_id}-${row.store_id}-${row.funding}-${row.model}`}
          empty="No AI use this month."
          columns={[
            { key: "reseller", header: "Reseller", cell: row => (row.reseller_id ? <AppLink href={`/resellers/${row.reseller_id}`} className="font-semibold text-brand-600 hover:underline">View</AppLink> : "—") },
            { key: "ai", header: "AI", cell: row => `${row.model} · ${row.funding === "own" ? "their key" : "Udozo’s"}` },
            { key: "calls", header: "Calls", cell: row => row.calls.toLocaleString("en-GB") },
            { key: "tokens", header: "Tokens in / out", cell: row => `${row.input_tokens.toLocaleString("en-GB")} / ${row.output_tokens.toLocaleString("en-GB")}`, hideOnMobile: true },
            { key: "cost", header: "Udozo’s cost", cell: row => (row.funding === "bitocard" ? usd(row.cost_usd) : "—") },
          ]}
        />
      </Card>
    </UdozoShell>
  );
}
