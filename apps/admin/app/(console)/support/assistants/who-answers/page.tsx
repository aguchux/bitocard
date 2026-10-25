"use client";

import { useRouter } from "next/navigation";
import { Badge, Card, DataTable, errorMessage, PageHeader } from "@bitocard/admin-ui";
import { AdminShell, AppLink } from "@bitocard/admin-ui/shell";
import { type ShopCoverageRow, useShopCoverageQuery } from "@bitocard/api-client/admin";

/** Who answers BitoCard Shop in each country and language: an assigned assistant, else Anjio (the default). */
export default function ShopCoveragePage() {
  const router = useRouter();
  const query = useShopCoverageQuery();
  return (
    <AdminShell section="support" current="/support/assistants" crumbs={[{ label: "Support", href: "/support" }, { label: "Assistants", href: "/support/assistants" }, { label: "Coverage" }]}>
      <PageHeader title="Coverage" description="Each country and language people can choose, with the assistant answering there. Anjio answers where no other assistant is assigned." />
      <Card>
        <DataTable<ShopCoverageRow>
          caption="Shop assistant coverage"
          rows={query.data?.data}
          loading={query.isLoading}
          error={query.error ? errorMessage(query.error) : null}
          onRetry={query.refetch}
          rowKey={row => `${row.country}-${row.language ?? "none"}`}
          onRowClick={row => (row.assistant ? router.push(`/support/assistants/${row.assistant.id}`) : undefined)}
          empty="BitoCard Shop is not open in any country yet."
          columns={[
            { key: "country", header: "Country", cell: row => <span className="flex items-center gap-2">{row.country_name}{row.open ? null : <Badge tone="grey">Shop closed</Badge>}</span> },
            { key: "language", header: "Language", cell: row => row.language_name ?? "—" },
            {
              key: "assistant",
              header: "Answered by",
              cell: row =>
                row.assistant ? (
                  <span className="flex items-center gap-2">
                    <AppLink href={`/support/assistants/${row.assistant.id}`} className="font-semibold text-brand-600 hover:underline">
                      {row.assistant.name}
                    </AppLink>
                    {row.assistant.default ? <Badge tone="pink">Default</Badge> : null}
                  </span>
                ) : (
                  <Badge tone="amber">No assistant</Badge>
                ),
            },
          ]}
        />
      </Card>
    </AdminShell>
  );
}
