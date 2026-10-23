"use client";

import { useState } from "react";
import { Wallet } from "lucide-react";
import { Badge, Card, CardHeader, DataTable, DateRangePicker, defaultDateRange, errorMessage, formatDateTime, formatMoney, PageHeader, Button, Select, type Column, type DateRange } from "@bitocard/admin-ui";
import { AdminShell, can, useAdmin } from "@bitocard/admin-ui/shell";
import {
  type Mode,
  type SupplierFloat,
  type SupplierFundingMovement,
  useSupplierFloatQuery,
  useSupplierFundingMovementsQuery,
  useSuppliersQuery,
} from "@bitocard/api-client/admin";
import { SupplierFundingDialog } from "@/components/supplier-funding";

const floatColumns: Array<Column<SupplierFloat>> = [
  { key: "supplier", header: "Supplier", cell: row => <span className="font-semibold text-ink">{row.supplier_name}</span> },
  { key: "currency", header: "Currency", cell: row => row.currency },
  { key: "consumed", header: "Drawn down (this range)", align: "right", hideOnMobile: true, cell: row => formatMoney(row.consumed, row.currency) },
  { key: "remaining", header: "Remaining", align: "right", cell: row => <span className="font-semibold tabular-nums">{formatMoney(row.remaining, row.currency)}</span> },
];

const statusTone: Record<SupplierFundingMovement["status"], "green" | "amber" | "grey"> = { completed: "green", awaiting_code: "amber", expired: "grey", cancelled: "grey" };
const statusLabel: Record<SupplierFundingMovement["status"], string> = { completed: "Done", awaiting_code: "Waiting for code", expired: "Code expired", cancelled: "Cancelled" };

const movementColumns: Array<Column<SupplierFundingMovement>> = [
  { key: "number", header: "Movement", cell: row => <span className="font-semibold text-ink">{row.number}</span> },
  { key: "supplier", header: "Supplier", cell: row => row.supplier.name },
  { key: "amount", header: "Amount", align: "right", cell: row => formatMoney(row.amount, row.currency) },
  { key: "status", header: "Status", cell: row => <Badge tone={statusTone[row.status]}>{statusLabel[row.status]}</Badge> },
  { key: "by", header: "By", hideOnMobile: true, cell: row => row.requested_by.name ?? "Admin" },
  { key: "when", header: "When", hideOnMobile: true, cell: row => formatDateTime(row.completed_at ?? row.created_at) },
];

/**
 * Reports > Supplier funding: what has been funded and drawn down per supplier (its float, the same balance orders
 * draw from automatically), and recording money sent to a supplier outside BitoCard.
 */
export default function SupplierFundingPage() {
  const admin = useAdmin();
  const finance = can(admin, "finance");
  const [mode, setMode] = useState<Mode>("live");
  const [range, setRange] = useState<DateRange>(defaultDateRange());
  const float = useSupplierFloatQuery({ mode, from: range.from, to: range.to });
  const movements = useSupplierFundingMovementsQuery({ mode });
  const suppliers = useSuppliersQuery();
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<SupplierFundingMovement | null>(null);

  return (
    <AdminShell section="reports" current="/reports/suppliers" crumbs={[{ label: "Reports", href: "/reports" }, { label: "Supplier funding" }]}>
      <PageHeader title="Supplier funding" description="Track money sent to each supplier's account against what orders have drawn down from it, and record a new bank transfer." />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <DateRangePicker value={range} onChange={setRange} />
        <Select value={mode} onChange={event => setMode(event.target.value as Mode)} className="w-auto">
          <option value="live">Live</option>
          <option value="test">Sandbox</option>
        </Select>
      </div>

      {done ? <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{`${done.number}: funded ${formatMoney(done.amount, done.currency)} to ${done.supplier.name}.`}</p> : null}
      {finance ? (
        <div>
          <Button icon={<Wallet className="size-4" aria-hidden />} onClick={() => setOpen(true)} disabled={!suppliers.data?.data.length}>
            Fund a supplier
          </Button>
        </div>
      ) : null}

      <Card>
        <CardHeader title="Float" description='Money BitoCard has prepaid to each supplier, less what fulfilled orders have drawn down in this range. "Remaining" is the live balance.' />
        <DataTable columns={floatColumns} rows={float.data?.data} rowKey={row => `${row.supplier_code}:${row.currency}`} loading={float.isLoading} error={float.error ? errorMessage(float.error) : null} onRetry={float.refetch} empty="No supplier has been funded yet." />
      </Card>

      <Card>
        <CardHeader title="Funding history" description="Every bank transfer recorded, confirmed by the code emailed to the admin who asked." />
        <DataTable columns={movementColumns} rows={movements.data?.data} rowKey={row => row.id} loading={movements.isLoading} error={movements.error ? errorMessage(movements.error) : null} onRetry={movements.refetch} empty="No movements yet." />
      </Card>

      {open && suppliers.data ? (
        <SupplierFundingDialog open mode={mode} suppliers={suppliers.data.data} onClose={() => setOpen(false)} onDone={setDone} />
      ) : null}
    </AdminShell>
  );
}
