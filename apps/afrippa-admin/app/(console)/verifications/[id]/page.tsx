"use client";

import { useParams } from "next/navigation";
import { errorMessage, KycCaseActions, KycCaseView, Notice, PageHeader, QueryView, Skeleton } from "@bitocard/admin-ui";
import { AppLink, can, useAdmin } from "@bitocard/admin-ui/shell";
import { apiBaseUrl } from "@bitocard/api-client";
import { type KycReviewDocument, useAdminKycCaseQuery, useDecideAdminKycCaseMutation } from "@bitocard/api-client/admin";
import { AfrippaShell } from "@/components/shell";

/**
 * Reads a document with the admin session cookie. The case's links are already Afrippa's own
 * (`/v1/afrippa/admin/kyc/cases/…`): the API streams the file from Afrippa's bucket, uncached, and audits the view.
 */
async function fetchDocument(document: KycReviewDocument) {
  const res = await fetch(`${apiBaseUrl()}${document.url}`, { credentials: "include", cache: "no-store" });
  if (!res.ok) throw new Error("Could not load this file.");
  return res.blob();
}

/** One trader's identity check: everything they sent, and the decision (operations decide; support reads). */
export default function TraderCheckPage() {
  const { id } = useParams<{ id: string }>();
  const admin = useAdmin();
  const query = useAdminKycCaseQuery(id);
  const [decide] = useDecideAdminKycCaseMutation();
  const operator = can(admin, "operations");

  return (
    <AfrippaShell section="traders" current="/verifications" crumbs={[{ label: "Traders" }, { label: "Identity checks", href: "/verifications" }, { label: "Check" }]}>
      <QueryView query={query} message={error => errorMessage(error, "Could not load this check.")} loading={<Skeleton className="h-96 w-full" />}>
        {kase => (
          <>
            <PageHeader
              title={kase.applicant.name ?? "A trader"}
              description={kase.applicant.email ? `Trader · ${kase.applicant.email}` : "Trader"}
              actions={operator ? <KycCaseActions key={`${kase.id}:${kase.status}`} kase={kase} override onDecide={decision => decide({ id: kase.id, decision }).unwrap()} /> : null}
            />
            {!operator ? <Notice tone="grey">Only operations admins can decide checks.</Notice> : null}
            <KycCaseView
              kase={kase}
              fetchDocument={fetchDocument}
              caseLink={other => (
                <AppLink href={`/verifications/${other}`} className="font-mono text-xs underline">
                  {other}
                </AppLink>
              )}
            />
            {kase.applicant.id ? (
              <p className="mt-4 text-sm text-muted">
                <AppLink href={`/crypto/customers/${kase.applicant.id}`} className="font-semibold text-brand-600 hover:underline">
                  The trader&apos;s wallets and standing
                </AppLink>
              </p>
            ) : null}
          </>
        )}
      </QueryView>
    </AfrippaShell>
  );
}
