"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { ActionDialog, Badge, Button, Card, DataTable, errorMessage, formatDateTime, PageHeader, Tabs, type Column } from "@bitocard/admin-ui";
import { AppLink, can, useAdmin } from "@bitocard/admin-ui/shell";
import { UdozoShell } from "@/components/shell";
import { type AdminResaleStoreReport, type ResaleStoreReportReason, useDecideResaleStoreReportMutation, useResaleStoreReportsQuery } from "@bitocard/api-client/admin";

type Status = AdminResaleStoreReport["status"];

const resaleReportReasonLabels: Record<ResaleStoreReportReason, string> = {
  claims_ownership: "Claims to own or make the items",
  misleading: "Said what the supplier did not",
  pay_outside: "Asked for payment outside Udozo",
  misused_details: "Misused a buyer’s details",
  other: "Something else",
};

/**
 * Udozo > Store reports (B2B reselling, stage 5): buyers and suppliers report a Resale shop, oldest first.
 * Operations uphold a report (a strike for the reseller; at the country's limit their Resale shops stop taking orders)
 * or dismiss it; the reporter is told either way. One open report per person and store.
 */
export default function ResaleStoreReportsPage() {
  return (
    <UdozoShell section="marketplace" current="/classifieds/resale-reports" crumbs={[{ label: "Marketplace", href: "/classifieds" }, { label: "Store reports" }]}>
      <PageHeader
        title="Store reports"
        description="Buyers and suppliers report a Resale shop that claimed to own the items, said what the supplier did not, asked for payment outside Udozo or misused a buyer’s details. An upheld report is a strike for the reseller."
      />
      <Suspense>
        <Reports />
      </Suspense>
    </UdozoShell>
  );
}

function Reports() {
  const admin = useAdmin();
  const resellerId = useSearchParams().get("reseller_id") ?? undefined;
  const [status, setStatus] = useState<Status>("open");
  const reports = useResaleStoreReportsQuery({ status, reseller_id: resellerId });
  const [decide] = useDecideResaleStoreReportMutation();
  const [open, setOpen] = useState<{ report: AdminResaleStoreReport; decision: "upheld" | "dismissed" } | null>(null);
  const decides = can(admin, "operations");

  const columns: Array<Column<AdminResaleStoreReport>> = [
    {
      key: "store",
      header: "Store",
      cell: item => (
        <span className="block">
          <span className="block font-semibold text-ink">{item.store.name}</span>
          <AppLink href={`/resellers/${item.reseller.id}`} className="text-xs text-brand-600 hover:underline">
            {item.number} · {item.reseller.name}
          </AppLink>
        </span>
      ),
    },
    {
      key: "reason",
      header: "Reason",
      cell: item => (
        <span className="block max-w-96">
          <Badge tone={item.reason === "pay_outside" || item.reason === "claims_ownership" ? "red" : "amber"}>{resaleReportReasonLabels[item.reason]}</Badge>
          <span className="mt-1 block whitespace-pre-line text-sm text-ink">{item.details}</span>
          {item.order_id ? (
            <AppLink href={`/classifieds/orders/${item.order_id}`} className="mt-1 block text-xs text-brand-600 hover:underline">
              The order
            </AppLink>
          ) : null}
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
          {item.reporter.name} <span className="text-muted">({item.reporter.kind})</span>
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
      cell: item =>
        item.status === "open" && decides ? (
          <span className="flex flex-wrap justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={() => setOpen({ report: item, decision: "dismissed" })}>
              Dismiss
            </Button>
            <Button size="sm" variant="danger" onClick={() => setOpen({ report: item, decision: "upheld" })}>
              Uphold
            </Button>
          </span>
        ) : null,
    },
  ];

  return (
    <>
      <div className="mt-6">
        <Tabs<Status>
          label="Report status"
          value={status}
          onChange={setStatus}
          items={[
            { value: "open", label: "Open" },
            { value: "upheld", label: "Upheld" },
            { value: "dismissed", label: "Dismissed" },
          ]}
        />
      </div>
      <Card className="mt-4">
        <DataTable columns={columns} rows={reports.data?.data} rowKey={item => item.id} loading={reports.isLoading} error={reports.error ? errorMessage(reports.error) : null} onRetry={reports.refetch} empty="No store reports here." />
      </Card>
      {open ? (
        <ActionDialog
          open
          onClose={() => setOpen(null)}
          title={open.decision === "upheld" ? `Uphold the report of ${open.report.store.name}?` : "Dismiss this report?"}
          description={
            open.decision === "upheld"
              ? "It counts as a strike for the reseller; at the country’s limit their Resale shops stop taking orders. The reseller and the reporter are told your note."
              : "Nothing changes for the store. The reporter is told your note."
          }
          confirmLabel={open.decision === "upheld" ? "Uphold" : "Dismiss"}
          tone={open.decision === "upheld" ? "danger" : "primary"}
          onConfirm={note => decide({ id: open.report.id, decision: open.decision, note }).unwrap()}
        />
      ) : null}
    </>
  );
}
