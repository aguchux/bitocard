"use client";

import { useState } from "react";
import { ActionDialog, Badge, Button, Card, CardHeader, DataTable, errorMessage, FilterSelect, formatDate, PageHeader, type Column } from "@bitocard/admin-ui";
import { AppLink, can, useAdmin } from "@bitocard/admin-ui/shell";
import { type ConnectTransfer, useCancelConnectTransferMutation, useConnectTransfersQuery } from "@bitocard/api-client/admin";
import { MarketFilter } from "@/components/classifieds";
import { money } from "@/components/connect";
import { UdozoShell } from "@/components/shell";

const transferStatusLabels: Record<ConnectTransfer["status"], string> = { paid: "To send", sent: "On its way", arrived: "At the centre", collected: "Collected", cancelled: "Cancelled" };
const statusTones: Record<ConnectTransfer["status"], "amber" | "blue" | "green" | "grey"> = { paid: "amber", sent: "blue", arrived: "blue", collected: "green", cancelled: "grey" };
const kindLabels: Record<ConnectTransfer["kind"], string> = { return: "Return sent on", lot: "Auction lot" };

/**
 * Connect > Transfers: items moving to a Connect Centre for someone to collect there. A seller's return sent on from the
 * centre holding it to one near them, or an abandoned item bought at a Udozo auction sent from Udozo's warehouse. The
 * payer's money is held until it is sent. Operations cancel one not yet sent (the money back to the payer); finance and
 * support read.
 */
export default function ConnectTransfersPage() {
  const admin = useAdmin();
  const operations = can(admin, "operations");
  const [country, setCountry] = useState("");
  const [status, setStatus] = useState<ConnectTransfer["status"] | "">("");
  const transfers = useConnectTransfersQuery({ country: country || undefined, status: status || undefined });
  const [cancel] = useCancelConnectTransferMutation();
  const [cancelling, setCancelling] = useState<ConnectTransfer | null>(null);

  const columns: Array<Column<ConnectTransfer>> = [
    {
      key: "item",
      header: "Item",
      cell: row => (
        <AppLink href={`/classifieds/orders/${row.order.id}`} className="block min-w-0 hover:underline">
          <span className="block truncate font-semibold text-ink">
            {row.number} · {row.order.title}
          </span>
          <span className="block text-xs text-muted">
            {kindLabels[row.kind]} · {row.return?.number ?? row.auction?.number ?? row.order.number} · for {row.recipient.name}
          </span>
        </AppLink>
      ),
    },
    {
      key: "route",
      header: "From and to",
      hideOnMobile: true,
      cell: row => (
        <span className="block min-w-0 text-sm">
          <span className="block truncate">From {row.from.name}</span>
          <span className="block truncate text-muted">
            To {row.to.name}, {row.to.state}
          </span>
        </span>
      ),
    },
    {
      key: "money",
      header: "Paid",
      cell: row => (
        <span className="grid gap-1 text-sm">
          <span className="font-semibold">{money(row.shipping + row.fee, row.currency)}</span>
          <span className="text-xs text-muted">{row.fee ? `Shipping ${money(row.shipping, row.currency)}, Connect fee ${money(row.fee, row.currency)}` : "Shipping"}</span>
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: row => (
        <span className="grid gap-1">
          <Badge tone={statusTones[row.status]}>{transferStatusLabels[row.status]}</Badge>
          <span className="text-xs text-muted">
            {row.status === "sent" && row.courier ? `${row.courier}${row.tracking_number ? ` (${row.tracking_number})` : ""}` : row.status === "cancelled" && row.cancel_reason ? row.cancel_reason : formatDate(row.arrived_at ?? row.sent_at ?? row.created_at)}
          </span>
        </span>
      ),
    },
    {
      key: "act",
      header: "",
      align: "right",
      cell: row =>
        operations && row.status === "paid" ? (
          <Button size="sm" variant="secondary" onClick={() => setCancelling(row)}>
            Cancel
          </Button>
        ) : null,
    },
  ];

  return (
    <UdozoShell section="connect" current="/connect/transfers" crumbs={[{ label: "Connect", href: "/connect/applications" }, { label: "Transfers" }]}>
      <PageHeader title="Transfers" description="Items sent to a Connect Centre for someone to collect there: sellers' returns sent on to a centre near them, and auction lots from Udozo's warehouses." />
      <div className="mt-6">
        <MarketFilter id="transfers-market" value={country} onChange={setCountry} />
      </div>
      <Card className="mt-4">
        <CardHeader
          title="Transfers"
          description="Centres only ever send to another Connect Centre. The shipping is the sender's once it is sent."
          actions={
            <FilterSelect
              id="transfers-status"
              label="Status"
              value={status}
              onChange={value => setStatus(value as ConnectTransfer["status"] | "")}
              options={[{ value: "", label: "All" }, ...(Object.keys(transferStatusLabels) as Array<ConnectTransfer["status"]>).map(value => ({ value, label: transferStatusLabels[value] }))]}
            />
          }
        />
        <DataTable<ConnectTransfer> caption="Transfers" columns={columns} rows={transfers.data?.data} loading={transfers.isLoading} error={transfers.error ? errorMessage(transfers.error) : null} onRetry={transfers.refetch} rowKey={row => row.id} empty="No transfers." />
      </Card>

      {cancelling ? (
        <ActionDialog
          open
          onClose={() => setCancelling(null)}
          title={`Cancel ${cancelling.number}?`}
          description={`${money(cancelling.shipping + cancelling.fee, cancelling.currency)} goes back to ${cancelling.recipient.name}, who is told why. The item stays where it is.`}
          confirmLabel="Cancel transfer"
          tone="danger"
          onConfirm={async reason => void (await cancel({ id: cancelling.id, reason }).unwrap())}
        />
      ) : null}
    </UdozoShell>
  );
}
