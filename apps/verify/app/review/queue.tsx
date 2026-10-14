"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Badge, Card, DataTable, formatRelative, LoadMore, Notice, PageHeader, StatusBadge, Tabs } from "@bitocard/admin-ui";
import { type KycReviewCase, kycStatusLabels } from "@bitocard/api-client/kyc";
import { useReview } from "@/components/review";
import { queueStatus, queueTabs, reviewListPath } from "@/lib/review";

type Page = { object: "list"; data: KycReviewCase[]; has_more: boolean };

/** Tabs by status (in the address), an optional customer filter (`?customer=`), newest pages on demand. */
export function ReviewQueue() {
  const { request, eligibility } = useReview();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const status = queueStatus(search.get("status"));
  const customer = search.get("customer");
  const [rows, setRows] = useState<KycReviewCase[] | undefined>(undefined);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const key = `${status}:${customer ?? ""}:${attempt}`;
  const [shown, setShown] = useState(key);
  if (shown !== key) {
    // A new tab or filter starts again (reset while rendering, not in an effect).
    setShown(key);
    setRows(undefined);
    setError(null);
  }

  useEffect(() => {
    let live = true;
    void request<Page>(reviewListPath({ status, customer })).then(result => {
      if (!live) return;
      if (result.ok) {
        setRows(result.data.data);
        setHasMore(result.data.has_more);
      } else setError(result.message);
    });
    return () => {
      live = false;
    };
  }, [request, status, customer, attempt]);

  const more = async () => {
    setLoadingMore(true);
    const result = await request<Page>(reviewListPath({ status, customer, after: rows?.at(-1)?.id }));
    setLoadingMore(false);
    if (result.ok) {
      setRows(current => [...(current ?? []), ...result.data.data]);
      setHasMore(result.data.has_more);
    } else setError(result.message);
  };

  const set = (changes: Record<string, string | null>) => {
    const params = new URLSearchParams(search.toString());
    for (const [name, value] of Object.entries(changes)) {
      if (value) params.set(name, value);
      else params.delete(name);
    }
    router.replace(`${pathname}?${params}`, { scroll: false });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Customers’ ID checks"
        description={`${eligibility.reseller.name} is a verified registered business, so you review your own customers’ checks. Your decision is final for your store.`}
      />
      <Notice tone="blue">Treat these documents as confidential: use them only to check your customers, and never copy or share them. BitoCard records every time a document is viewed.</Notice>
      {customer ? (
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <Badge tone="blue">One customer</Badge>
          <button type="button" className="font-semibold text-brand-600 hover:underline" onClick={() => set({ customer: null })}>
            Show every customer
          </button>
        </p>
      ) : null}
      <Card>
        <div className="px-4 pt-2 sm:px-5">
          <Tabs label="Status" value={status} onChange={value => set({ status: value })} items={queueTabs} />
        </div>
        <DataTable
          caption="ID checks"
          rows={rows}
          loading={rows === undefined && !error}
          error={rows === undefined ? error : null}
          onRetry={() => setAttempt(value => value + 1)}
          rowKey={row => row.id}
          onRowClick={row => router.push(`/review/${row.id}`)}
          empty={status === "submitted" ? "Nothing to review. New checks appear here." : "No checks here."}
          columns={[
            {
              key: "applicant",
              header: "Customer",
              cell: row => (
                <span className="block min-w-0">
                  <Link href={`/review/${row.id}`} className="font-semibold text-ink hover:underline" onClick={event => event.stopPropagation()}>
                    {row.applicant.name}
                  </Link>
                  <span className="block break-all text-sm text-muted">{row.applicant.email}</span>
                </span>
              ),
            },
            { key: "store", header: "Store", hideOnMobile: true, cell: row => row.store?.name ?? "—" },
            {
              key: "status",
              header: "Status",
              cell: row => (
                <span className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={row.status} label={kycStatusLabels[row.status]} />
                  {row.duplicates.length ? <Badge tone="amber">ID seen before</Badge> : null}
                  {row.mode === "test" ? <Badge tone="amber">Test</Badge> : null}
                </span>
              ),
            },
            { key: "submitted", header: "Sent", hideOnMobile: true, cell: row => formatRelative(row.submitted_at) },
          ]}
        />
        {rows && error ? <p className="px-5 pb-4 text-sm text-red-700">{error}</p> : null}
        <LoadMore hasMore={hasMore} loading={loadingMore} onClick={() => void more()} />
      </Card>
    </div>
  );
}
