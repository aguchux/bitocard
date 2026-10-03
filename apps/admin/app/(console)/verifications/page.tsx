"use client";

import { PageHeader } from "@bitocard/admin-ui";
import { AdminShell } from "@bitocard/admin-ui/shell";
import { VerificationList } from "@/components/verification-list";

export default function VerificationReviewPage() {
  return (
    <AdminShell section="verifications" current="/verifications" crumbs={[{ label: "Identity", href: "/verifications" }, { label: "Needs review" }]}>
      <PageHeader title="Identity checks to review" description="Checks the provider sent for a person to decide. Look at each one in the provider’s console before deciding." />
      <VerificationList status="in_review" />
    </AdminShell>
  );
}
