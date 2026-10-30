"use client";

import { useState } from "react";
import { ActionDialog, Badge, Button, Card, DataTable, errorMessage, formatDateTime, PageHeader, Tabs, type Column } from "@bitocard/admin-ui";
import { AppLink, can, useAdmin } from "@bitocard/admin-ui/shell";
import { UdozoShell } from "@/components/shell";
import { type AdminClassifiedReport, type ClassifiedReportStatus, useClassifiedReportsQuery, useResolveClassifiedReportMutation } from "@bitocard/api-client/admin";
import { ListingStatus, reportReasonLabels } from "@/components/classifieds";

type Decision = { report: AdminClassifiedReport; action: "dismiss" | "remove_listing" };

/**
 * Udozo > Reports: what customers reported (an ad, or the person they were chatting with), oldest first.
 * A reported chat can be read in full from here (each read is audited). Operations dismiss a report or remove the ad.
 */
export default function ClassifiedReportsPage() {
  const admin = useAdmin();
  const [status, setStatus] = useState<ClassifiedReportStatus>("open");
  const reports = useClassifiedReportsQuery({ status });
  const [resolve] = useResolveClassifiedReportMutation();
  const [open, setOpen] = useState<Decision | null>(null);
  const decides = can(admin, "operations");

  const columns: Array<Column<AdminClassifiedReport>> = [
    {
      key: "about",
      header: "About",
      cell: item =>
        item.listing ? (
          <AppLink href={`/classifieds/listings/${item.listing.id}`} className="block hover:underline">
            <span className="block font-semibold text-ink">{item.listing.title ?? "Untitled"}</span>
            <span className="mt-1 flex items-center gap-2 text-xs text-muted">
              #{item.listing.ref} · {item.listing.country} <ListingStatus status={item.listing.status} />
            </span>
          </AppLink>
        ) : item.reported_customer_id ? (
          <AppLink href={`/classifieds/sellers/${item.reported_customer_id}`} className="font-semibold text-brand-600 hover:underline">
            A person in a chat
          </AppLink>
        ) : (
          "—"
        ),
    },
    {
      key: "reason",
      header: "Reason",
      cell: item => (
        <span className="block max-w-80">
          <Badge tone={item.reason === "scam" || item.reason === "prohibited" ? "red" : "amber"}>{reportReasonLabels[item.reason] ?? item.reason}</Badge>
          {item.details ? <span className="mt-1 block text-sm text-ink">{item.details}</span> : null}
          {item.note ? <span className="mt-1 block text-xs text-muted">Decided: {item.note}</span> : null}
        </span>
      ),
    },
    {
      key: "by",
      header: "Reported by",
      hideOnMobile: true,
      cell: item => (
        <span className="block text-sm">
          {item.reporter.name}
          <span className="block text-xs text-muted">
            {item.reporter.email} · {formatDateTime(item.created_at)}
          </span>
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      cell: item => (
        <span className="flex flex-wrap justify-end gap-2">
          {item.conversation_id ? (
            <AppLink href={`/classifieds/conversations/${item.conversation_id}`} className="rounded-lg px-3 py-1.5 text-sm font-semibold text-brand-600 hover:bg-brand-50">
              Read the chat
            </AppLink>
          ) : null}
          {item.status === "open" && decides ? (
            <>
              <Button size="sm" variant="secondary" onClick={() => setOpen({ report: item, action: "dismiss" })}>
                Dismiss
              </Button>
              {item.listing ? (
                <Button size="sm" variant="danger" onClick={() => setOpen({ report: item, action: "remove_listing" })}>
                  Remove the ad
                </Button>
              ) : null}
            </>
          ) : null}
        </span>
      ),
    },
  ];

  return (
    <UdozoShell section="marketplace" current="/classifieds/reports" crumbs={[{ label: "Marketplace", href: "/classifieds" }, { label: "Reports" }]}>
      <PageHeader
        title="Reports"
        description="What customers reported. Three open reports from different customers send a live ad back to review. Chats are private: you can read one only once it has been reported, and every read is recorded."
      />
      <div className="mt-6">
        <Tabs
          label="Report status"
          value={status}
          onChange={setStatus}
          items={[
            { value: "open", label: "Open" },
            { value: "actioned", label: "Ad removed" },
            { value: "dismissed", label: "Dismissed" },
          ]}
        />
      </div>
      <Card className="mt-4">
        <DataTable columns={columns} rows={reports.data?.data} rowKey={item => item.id} loading={reports.isLoading} error={reports.error ? errorMessage(reports.error) : null} onRetry={reports.refetch} empty="No reports here." />
      </Card>
      {open ? (
        <ActionDialog
          open
          onClose={() => setOpen(null)}
          title={open.action === "dismiss" ? "Dismiss this report?" : "Remove the ad?"}
          description={
            open.action === "dismiss"
              ? "Nothing changes for the ad or the person. Your note is kept with the report."
              : "The ad leaves Udozo for good, its other open reports are closed and the seller is told your reason."
          }
          confirmLabel={open.action === "dismiss" ? "Dismiss" : "Remove the ad"}
          tone={open.action === "dismiss" ? "primary" : "danger"}
          onConfirm={note => resolve({ id: open.report.id, action: open.action, note }).unwrap()}
        />
      ) : null}
    </UdozoShell>
  );
}
