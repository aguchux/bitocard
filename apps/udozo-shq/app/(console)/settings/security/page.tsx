"use client";

import { PageHeader } from "@bitocard/admin-ui";
import { ShqShell } from "@/components/shq-shell";
import { TwoStepCard } from "@/components/two-step";

/** The signed-in person's sign-in security: two-step sign-in. It applies to every reseller account they belong to. */
export default function SecurityPage() {
  return (
    <ShqShell section="settings" current="/settings/security" crumbs={[{ label: "Settings", href: "/settings" }, { label: "Security" }]}>
      <PageHeader title="Security" description="How you sign in. It applies to every reseller account you belong to." />
      <TwoStepCard />
    </ShqShell>
  );
}
