"use client";

import { PageHeader } from "@bitocard/admin-ui";
import { UdozoShell } from "@/components/shell";
import { VerificationList } from "@/components/verification-list";

export default function VerificationReviewPage() {
  return (
    <UdozoShell section="verifications" current="/verifications" crumbs={[{ label: "Identity", href: "/verifications" }, { label: "Needs review" }]}>
      <PageHeader title="Identity checks to review" description="Checks waiting for a person to decide. Udozo Verify's open their case, with the documents, selfie and liveness frames; Didit's are checked in Didit's console first." />
      <VerificationList status="in_review" />
    </UdozoShell>
  );
}
