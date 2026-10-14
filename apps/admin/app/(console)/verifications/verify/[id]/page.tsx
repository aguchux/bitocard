"use client";

import { useParams } from "next/navigation";
import { errorMessage, KycCaseActions, KycCaseView, Notice, PageHeader, QueryView, Skeleton } from "@bitocard/admin-ui";
import { AdminShell, AppLink, can, useAdmin } from "@bitocard/admin-ui/shell";
import { apiBaseUrl } from "@bitocard/api-client";
import { type KycReviewDocument, useAdminKycCaseQuery, useDecideAdminKycCaseMutation } from "@bitocard/api-client/admin";

/** Reads a document with the admin session cookie (the API streams it decrypted, uncached, and audits the view). */
async function fetchDocument(document: KycReviewDocument) {
  const res = await fetch(`${apiBaseUrl()}${document.url}`, { credentials: "include", cache: "no-store" });
  if (!res.ok) throw new Error("Could not load this file.");
  return res.blob();
}

/** One BitoCard Verify case: everything the applicant sent, and the decision (operations decide; support reads). */
export default function KycCasePage() {
  const { id } = useParams<{ id: string }>();
  const admin = useAdmin();
  const query = useAdminKycCaseQuery(id);
  const [decide] = useDecideAdminKycCaseMutation();
  const operator = can(admin, "operations");

  return (
    <AdminShell section="verifications" current="/verifications/verify" crumbs={[{ label: "Identity", href: "/verifications" }, { label: "BitoCard Verify", href: "/verifications/verify" }, { label: "Case" }]}>
      <QueryView query={query} message={error => errorMessage(error, "Could not load this case.")} loading={<Skeleton className="h-96 w-full" />}>
        {kase => (
          <>
            <PageHeader
              title={kase.applicant.name}
              description={kase.subject === "reseller" ? `Owner of ${kase.reseller.name}` : `Customer of ${kase.store?.name ?? kase.reseller.name}`}
              actions={operator ? <KycCaseActions key={`${kase.id}:${kase.status}`} kase={kase} override onDecide={decision => decide({ id: kase.id, decision }).unwrap()} /> : null}
            />
            {kase.reviewer === "reseller" && kase.status === "submitted" ? (
              <Notice tone="blue">This customer’s store is a verified registered business, so the store reviews this case. Decide it here only if it needs BitoCard.</Notice>
            ) : null}
            {!operator ? <Notice tone="grey">Only operations admins can decide cases.</Notice> : null}
            <KycCaseView
              kase={kase}
              fetchDocument={fetchDocument}
              caseLink={other => (
                <AppLink href={`/verifications/verify/${other}`} className="font-mono text-xs underline">
                  {other}
                </AppLink>
              )}
            />
          </>
        )}
      </QueryView>
    </AdminShell>
  );
}
