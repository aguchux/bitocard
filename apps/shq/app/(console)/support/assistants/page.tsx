"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Card, DataTable, errorMessage, Notice, PageHeader, StatusBadge } from "@bitocard/admin-ui";
import { botStatusLabels, providerLabels, roleLabels } from "@bitocard/admin-ui/support";
import { type SupportBot, useSupportBotsQuery } from "@bitocard/api-client/reseller";
import { ShqShell } from "@/components/shq-shell";
import { can, useReseller } from "@/components/reseller";

/** The reseller's support assistants: one per store. */
export default function AssistantsPage() {
  const router = useRouter();
  const { membership } = useReseller();
  const allowed = can(membership, "admin");
  const query = useSupportBotsQuery("/v1/support/bots", { skip: !allowed });
  return (
    <ShqShell section="support" current="/support/assistants" crumbs={[{ label: "Support", href: "/support" }, { label: "Assistants" }]}>
      <PageHeader
        title="Assistants"
        description="An AI assistant answers your store’s chats and tickets from what it knows about your business, and hands over to your team when it should. One per store."
        actions={
          allowed ? (
            <Link href="/support/assistants/new" className="inline-flex items-center gap-2 rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-600">
              <Plus className="size-4" aria-hidden />
              New assistant
            </Link>
          ) : null
        }
      />
      {!allowed ? (
        <Notice tone="grey" title="Owners and admins only">
          Only the owner and admins set up assistants.
        </Notice>
      ) : (
        <Card>
          <DataTable<SupportBot>
            caption="Assistants"
            rows={query.isLoading ? undefined : query.data?.data}
            loading={query.isLoading}
            error={query.error ? errorMessage(query.error) : null}
            onRetry={query.refetch}
            rowKey={row => row.id}
            onRowClick={row => router.push(`/support/assistants/${row.id}`)}
            empty="No assistant yet. Create one to answer your customers day and night."
            columns={[
              {
                key: "name",
                header: "Assistant",
                cell: row => (
                  <Link href={`/support/assistants/${row.id}`} className="font-semibold text-brand-600 hover:underline">
                    {row.name}
                  </Link>
                ),
              },
              { key: "store", header: "Store", cell: row => row.store_name ?? "Not assigned" },
              { key: "does", header: "Answers", cell: row => row.roles.map(role => roleLabels[role]).join(", "), hideOnMobile: true },
              { key: "ai", header: "AI", cell: row => `${providerLabels[row.provider]} · ${row.funding === "own" ? "your key" : "BitoCard’s"}`, hideOnMobile: true },
              {
                key: "status",
                header: "Status",
                cell: row => <StatusBadge status={row.status === "active" ? "active" : row.status === "suspended" ? "failed" : "pending"} label={row.knowledge_stale_at ? `${botStatusLabels[row.status]} · update knowledge` : botStatusLabels[row.status]} />,
              },
            ]}
          />
        </Card>
      )}
    </ShqShell>
  );
}
