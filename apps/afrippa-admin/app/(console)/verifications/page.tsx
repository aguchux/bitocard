"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Card, DataTable, errorMessage, FilterSelect, formatRelative, LoadMore, PageHeader, StatusBadge } from "@bitocard/admin-ui";
import { AppLink } from "@bitocard/admin-ui/shell";
import { type KycStatus, kycStatusLabels, useAdminKycCasesInfiniteQuery } from "@bitocard/api-client/admin";
import { AfrippaShell } from "@/components/shell";

/**
 * Traders' identity checks (verify.afrippa.com), decided by a person on Afrippa's team: only Afrippa's cases, never
 * BitoCard's (the shared hooks reach `/v1/afrippa/admin/kyc/cases` here).
 */
export default function TraderChecksPage() {
  const router = useRouter();
  const [status, setStatus] = useState<KycStatus | "">("submitted");
  const query = useAdminKycCasesInfiniteQuery({ status: status || "all" });
  const rows = query.data?.pages.flatMap(page => page.data);

  return (
    <AfrippaShell section="traders" current="/verifications" crumbs={[{ label: "Traders" }, { label: "Identity checks" }]}>
      <PageHeader
        title="Identity checks"
        description="Traders' ID checks from verify.afrippa.com. Look at every document, the selfie beside the ID photo and the liveness frames before deciding."
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <FilterSelect
          id="kyc-status"
          label="Status"
          value={status}
          onChange={value => setStatus(value as KycStatus | "")}
          options={[{ value: "", label: "Any" }, ...(Object.entries(kycStatusLabels) as Array<[KycStatus, string]>).map(([value, label]) => ({ value, label }))]}
        />
      </div>
      <Card>
        <DataTable
          caption="Identity checks"
          rows={rows}
          loading={query.isLoading}
          error={query.error ? errorMessage(query.error) : null}
          onRetry={query.refetch}
          rowKey={row => row.id}
          onRowClick={row => router.push(`/verifications/${row.id}`)}
          empty={status === "submitted" ? "Nothing to review." : "No checks match."}
          columns={[
            {
              key: "applicant",
              header: "Trader",
              cell: row => (
                <span className="block min-w-0">
                  <AppLink href={`/verifications/${row.id}`} className="font-semibold hover:underline">
                    {row.applicant.name ?? "A trader"}
                  </AppLink>
                  {row.applicant.email ? <span className="block text-xs text-muted">{row.applicant.email}</span> : null}
                </span>
              ),
            },
            { key: "country", header: "Country", cell: row => row.country },
            {
              key: "status",
              header: "Status",
              cell: row => (
                <span className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={row.status} label={kycStatusLabels[row.status]} />
                  {row.duplicates.length ? <Badge tone="amber">Duplicate ID</Badge> : null}
                  {row.mode === "test" ? <Badge tone="amber">Test</Badge> : null}
                </span>
              ),
            },
            { key: "submitted", header: "Sent", hideOnMobile: true, cell: row => formatRelative(row.submitted_at) },
          ]}
        />
        <LoadMore hasMore={query.hasNextPage} loading={query.isFetchingNextPage} onClick={() => query.fetchNextPage()} />
      </Card>
    </AfrippaShell>
  );
}
