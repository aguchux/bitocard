"use client";

import { useState } from "react";
import { ActionDialog, Badge, Button, Card, DataTable, FilterSelect, formatDateTime, PageHeader, QueryView, Skeleton, type Column, type Tone } from "@bitocard/admin-ui";
import { AppLink, can, useAdmin } from "@bitocard/admin-ui/shell";
import { type P2pReport, useDecideReportMutation, useP2pReportsQuery } from "@bitocard/api-client/afrippa-admin";
import { AfrippaShell } from "@/components/shell";

const reasons: Record<P2pReport["reason"], string> = {
  fraud: "Fraud or a scam",
  fake_payment: "Said they paid but did not",
  third_party_payment: "Paid from someone else's account",
  off_platform: "Asked to trade off Afrippa",
  abuse: "Abusive or threatening",
  other: "Something else",
};
const tones: Record<P2pReport["status"], [string, Tone]> = { open: ["Open", "amber"], upheld: ["Upheld", "red"], dismissed: ["Dismissed", "grey"] };

/**
 * Orders > Reports: traders reporting traders, oldest first. Operations uphold one (a strike against the reported
 * trader) or dismiss it, once, with a note; the reporter is told the outcome.
 */
export default function ReportsPage() {
  const admin = useAdmin();
  const [status, setStatus] = useState<"open" | "upheld" | "dismissed" | "">("open");
  const query = useP2pReportsQuery(status ? { status } : {});
  const [decide] = useDecideReportMutation();
  const [open, setOpen] = useState<{ report: P2pReport; decision: "upheld" | "dismissed" } | null>(null);
  const decides = can(admin, "operations");

  const columns: Array<Column<P2pReport>> = [
    {
      key: "report",
      header: "Report",
      cell: report => (
        <span className="block min-w-0">
          <span className="block font-semibold text-ink">
            {report.number}: {report.reported}
          </span>
          <span className="block text-xs text-muted">
            {reasons[report.reason]} · from {report.reporter} · {formatDateTime(report.created_at)}
          </span>
          <span className="mt-1 block whitespace-pre-wrap text-sm text-ink">{report.details}</span>
          {report.order_id ? (
            <AppLink href={`/orders/${report.order_id}`} className="text-xs font-semibold text-brand-600 hover:underline">
              The order
            </AppLink>
          ) : null}
          {report.decision_note ? <span className="mt-1 block text-xs text-muted">Note: {report.decision_note}</span> : null}
        </span>
      ),
    },
    { key: "status", header: "Status", cell: report => <Badge tone={tones[report.status][1]}>{tones[report.status][0]}</Badge> },
    {
      key: "actions",
      header: "",
      cell: report =>
        report.status === "open" && decides ? (
          <span className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setOpen({ report, decision: "upheld" })}>
              Uphold
            </Button>
            <Button variant="ghost" onClick={() => setOpen({ report, decision: "dismissed" })}>
              Dismiss
            </Button>
          </span>
        ) : null,
    },
  ];

  return (
    <AfrippaShell section="orders" current="/reports" crumbs={[{ label: "Orders", href: "/orders" }, { label: "Reports" }]}>
      <PageHeader title="Reports" description="Traders reporting other traders. An upheld report is a strike against the reported trader and starts a 24-hour cool-off." />
      <div className="mb-4 flex flex-wrap gap-3">
        <FilterSelect
          id="status"
          label="Status"
          value={status}
          onChange={value => setStatus(value as typeof status)}
          options={[
            { value: "open", label: "Open" },
            { value: "upheld", label: "Upheld" },
            { value: "dismissed", label: "Dismissed" },
            { value: "", label: "All" },
          ]}
        />
      </div>
      <Card>
        <QueryView query={query} loading={<Skeleton className="h-64" />}>
          {data => <DataTable columns={columns} rows={data.data} rowKey={report => report.id} empty="No reports." />}
        </QueryView>
      </Card>
      {open ? (
        <ActionDialog
          open
          onClose={() => setOpen(null)}
          title={`${open.decision === "upheld" ? "Uphold" : "Dismiss"} ${open.report.number}?`}
          description={open.decision === "upheld" ? `A strike against ${open.report.reported}: at three in 90 days their trading pauses.` : "Nothing changes for the reported trader. The reporter is told."}
          confirmLabel={open.decision === "upheld" ? "Uphold" : "Dismiss"}
          tone={open.decision === "upheld" ? "danger" : "primary"}
          onConfirm={note => decide({ id: open.report.id, decision: open.decision, note }).unwrap()}
        />
      ) : null}
    </AfrippaShell>
  );
}
