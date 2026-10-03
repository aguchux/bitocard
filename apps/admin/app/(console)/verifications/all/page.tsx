"use client";

import { useState } from "react";
import { PageHeader, Tabs } from "@bitocard/admin-ui";
import { AdminShell } from "@bitocard/admin-ui/shell";
import type { VerificationStatus } from "@bitocard/api-client/admin";
import { VerificationList } from "@/components/verification-list";

type Filter = "all" | VerificationStatus;

export default function AllVerificationsPage() {
  const [status, setStatus] = useState<Filter>("all");
  const [subject, setSubject] = useState<"all" | "reseller" | "customer">("all");
  return (
    <AdminShell section="verifications" current="/verifications/all" crumbs={[{ label: "Identity", href: "/verifications" }, { label: "All checks" }]}>
      <PageHeader title="All identity checks" description="Reseller owners (Didit) and customers (BVN in Nigeria, Didit elsewhere). Only outcomes are kept, never documents or BVNs." />
      <div className="flex flex-wrap justify-between gap-3">
        <Tabs
          label="Status"
          value={status}
          onChange={setStatus}
          items={[
            { value: "all", label: "All" },
            { value: "in_progress", label: "In progress" },
            { value: "in_review", label: "In review" },
            { value: "approved", label: "Approved" },
            { value: "declined", label: "Declined" },
            { value: "expired", label: "Expired" },
          ]}
        />
        <Tabs
          label="Who"
          variant="pills"
          value={subject}
          onChange={setSubject}
          items={[
            { value: "all", label: "Everyone" },
            { value: "reseller", label: "Resellers" },
            { value: "customer", label: "Customers" },
          ]}
        />
      </div>
      <VerificationList status={status === "all" ? undefined : status} subject={subject === "all" ? undefined : subject} />
    </AdminShell>
  );
}
