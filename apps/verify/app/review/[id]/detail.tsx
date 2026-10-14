"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Card, ErrorState, KycCaseActions, KycCaseView, PageHeader, Skeleton } from "@bitocard/admin-ui";
import { type KycReviewCase, kycDecisionBody } from "@bitocard/api-client/kyc";
import { useReview } from "@/components/review";
import { fetchReviewDocument } from "@/lib/review";

/** One customer's check: everything they sent, side by side, and the decision. */
export function ReviewCaseDetail({ id }: { id: string }) {
  const { request, reseller } = useReview();
  const [kase, setKase] = useState<KycReviewCase | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    void request<KycReviewCase>(`/v1/kyc/reviews/${encodeURIComponent(id)}`).then(result => {
      if (!live) return;
      if (result.ok) setKase(result.data);
      else setError(result.status === 404 ? "This check was not found, or it is not one of your customers’." : result.message);
    });
    return () => {
      live = false;
    };
  }, [request, id, attempt]);

  return (
    <div className="space-y-6">
      <Link href="/review" className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> All checks
      </Link>
      {kase ? (
        <>
          <PageHeader
            title={kase.applicant.name}
            description={kase.store ? `A customer of ${kase.store.name}.` : undefined}
            actions={
              <KycCaseActions
                kase={kase}
                onDecide={async decision => {
                  const result = await request<KycReviewCase>(`/v1/kyc/reviews/${encodeURIComponent(kase.id)}/${decision.action}`, { method: "POST", body: kycDecisionBody(decision) });
                  if (!result.ok) throw new Error(result.message);
                  setKase(result.data);
                }}
              />
            }
          />
          <KycCaseView kase={kase} fetchDocument={document => fetchReviewDocument(document.url, reseller)} />
        </>
      ) : error ? (
        <Card>
          <ErrorState
            message={error}
            onRetry={() => {
              setError(null);
              setAttempt(value => value + 1);
            }}
          />
        </Card>
      ) : (
        <Skeleton className="h-96 w-full" />
      )}
    </div>
  );
}
