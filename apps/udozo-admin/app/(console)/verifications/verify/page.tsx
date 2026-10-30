"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Card, DataTable, errorMessage, FilterSelect, formatRelative, LoadMore, PageHeader, StatusBadge } from "@bitocard/admin-ui";
import { AppLink } from "@bitocard/admin-ui/shell";
import { UdozoShell } from "@/components/shell";
import { type KycKind, type KycReviewer, type KycStatus, type KycSubject, kycStatusLabels, useAdminKycCasesInfiniteQuery } from "@bitocard/api-client/admin";

const any = "";

/**
 * Udozo Verify: Udozo's own ID (and business) checks in African markets, decided by a person. Cases routed to a
 * registered reseller are theirs to decide, but admins can open and override any of them.
 */
export default function KycCasesPage() {
  const router = useRouter();
  const [status, setStatus] = useState<KycStatus | "">("submitted");
  const [subject, setSubject] = useState<KycSubject | "">(any);
  const [kind, setKind] = useState<KycKind | "">(any);
  const [reviewer, setReviewer] = useState<KycReviewer | "">(any);
  const query = useAdminKycCasesInfiniteQuery({ status: status || "all", subject: subject || undefined, kind: kind || undefined, reviewer: reviewer || undefined });
  const rows = query.data?.pages.flatMap(page => page.data);

  return (
    <UdozoShell section="verifications" current="/verifications/verify" crumbs={[{ label: "Identity", href: "/verifications" }, { label: "Udozo Verify" }]}>
      <PageHeader
        title="Udozo Verify"
        description="ID checks for African markets, and business checks for resellers there. Look at every document, the selfie beside the ID photo and the liveness frames before deciding."
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <FilterSelect
          id="kyc-status"
          label="Status"
          value={status}
          onChange={value => setStatus(value as KycStatus | "")}
          options={[{ value: any, label: "Any" }, ...(Object.entries(kycStatusLabels) as Array<[KycStatus, string]>).map(([value, label]) => ({ value, label }))]}
        />
        <FilterSelect
          id="kyc-subject"
          label="Who"
          value={subject}
          onChange={value => setSubject(value as KycSubject | "")}
          options={[
            { value: any, label: "Everyone" },
            { value: "reseller", label: "Resellers" },
            { value: "customer", label: "Customers" },
          ]}
        />
        <FilterSelect
          id="kyc-kind"
          label="Check"
          value={kind}
          onChange={value => setKind(value as KycKind | "")}
          options={[
            { value: any, label: "Any" },
            { value: "kyc", label: "Identity (KYC)" },
            { value: "kyb", label: "Business (KYB)" },
          ]}
        />
        <FilterSelect
          id="kyc-reviewer"
          label="Reviewed by"
          value={reviewer}
          onChange={value => setReviewer(value as KycReviewer | "")}
          options={[
            { value: any, label: "Anyone" },
            { value: "admin", label: "Udozo" },
            { value: "reseller", label: "The store’s business" },
          ]}
        />
      </div>
      <Card>
        <DataTable
          caption="Udozo Verify cases"
          rows={rows}
          loading={query.isLoading}
          error={query.error ? errorMessage(query.error) : null}
          onRetry={query.refetch}
          rowKey={row => row.id}
          onRowClick={row => router.push(`/verifications/verify/${row.id}`)}
          empty={status === "submitted" ? "Nothing to review." : "No cases match."}
          columns={[
            {
              key: "applicant",
              header: "Applicant",
              cell: row => (
                <span className="block min-w-0">
                  <AppLink href={`/verifications/verify/${row.id}`} className="font-semibold hover:underline">
                    {row.applicant.name}
                  </AppLink>
                  <span className="block text-xs text-muted">{row.subject === "reseller" ? "Reseller owner" : `Customer of ${row.store?.name ?? row.reseller.name}`}</span>
                </span>
              ),
            },
            { key: "kind", header: "Check", hideOnMobile: true, cell: row => (row.kind === "kyb" ? `Business${row.business_type === "registered" ? " (registered)" : ""}` : "Identity") },
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
            { key: "reviewer", header: "Reviewer", hideOnMobile: true, cell: row => (row.reviewer === "reseller" ? "Store’s business" : "Udozo") },
            { key: "submitted", header: "Sent", hideOnMobile: true, cell: row => formatRelative(row.submitted_at) },
          ]}
        />
        <LoadMore hasMore={query.hasNextPage} loading={query.isFetchingNextPage} onClick={() => query.fetchNextPage()} />
      </Card>
    </UdozoShell>
  );
}
