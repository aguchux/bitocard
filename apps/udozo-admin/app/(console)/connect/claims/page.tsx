"use client";

import { useState } from "react";
import { ActionDialog, Badge, Button, Card, CardHeader, DataTable, errorMessage, FilterSelect, formatDate, PageHeader, type Column } from "@bitocard/admin-ui";
import { AppLink, can, useAdmin } from "@bitocard/admin-ui/shell";
import { type ConnectAuctionClaim, useConnectClaimsQuery, usePayConnectClaimMutation, useRejectConnectClaimMutation } from "@bitocard/api-client/admin";
import { MarketFilter } from "@/components/classifieds";
import { money } from "@/components/connect";
import { UdozoShell } from "@/components/shell";

const statusLabels: Record<ConnectAuctionClaim["status"], string> = { requested: "To check", paid: "Paid", rejected: "Rejected" };
const statusTones: Record<ConnectAuctionClaim["status"], "amber" | "green" | "grey"> = { requested: "amber", paid: "green", rejected: "grey" };

/**
 * Connect > Claims: sellers' claims to what the Udozo auction of their abandoned item left over. Finance checks each one
 * and pays it into the seller's Udozo money (after the authenticator code) or rejects it with why; the seller may claim
 * again while their days last, and what nobody claims in time becomes Udozo's by itself. Operations and support read.
 */
export default function ConnectClaimsPage() {
  const admin = useAdmin();
  const finance = can(admin, "finance");
  const [country, setCountry] = useState("");
  const [status, setStatus] = useState<ConnectAuctionClaim["status"] | "">("requested");
  const claims = useConnectClaimsQuery({ country: country || undefined, status: status || undefined });
  const [pay] = usePayConnectClaimMutation();
  const [reject] = useRejectConnectClaimMutation();
  const [paying, setPaying] = useState<ConnectAuctionClaim | null>(null);
  const [rejecting, setRejecting] = useState<ConnectAuctionClaim | null>(null);

  const columns: Array<Column<ConnectAuctionClaim>> = [
    {
      key: "claim",
      header: "Claim",
      cell: row => (
        <AppLink href={`/classifieds/orders/${row.order.id}`} className="block min-w-0 hover:underline">
          <span className="block truncate font-semibold text-ink">
            {row.number} · {row.auction.title}
          </span>
          <span className="block text-xs text-muted">
            {row.auction.number} · {row.order.number} · {formatDate(row.created_at)}
          </span>
        </AppLink>
      ),
    },
    {
      key: "seller",
      header: "Seller",
      cell: row => (
        <span className="block min-w-0">
          <span className="block truncate text-sm text-ink">{row.seller.name}</span>
          <span className="block truncate text-xs text-muted">{row.seller.email}</span>
          {row.note ? <span className="block text-xs text-muted">“{row.note}”</span> : null}
        </span>
      ),
    },
    {
      key: "amount",
      header: "Left over",
      cell: row => (
        <span className="grid gap-1 text-sm">
          <span className="font-semibold">{money(row.amount, row.currency)}</span>
          <span className="text-xs text-muted">Sold for {money(row.auction.sale, row.currency)}</span>
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: row => (
        <span className="grid gap-1">
          <Badge tone={statusTones[row.status]}>{statusLabels[row.status]}</Badge>
          {row.decision_note ? <span className="text-xs text-muted">{row.decision_note}</span> : row.status === "requested" && row.auction.claim_by ? <span className="text-xs text-muted">Days to claim end {formatDate(row.auction.claim_by)}</span> : null}
        </span>
      ),
    },
    {
      key: "act",
      header: "",
      align: "right",
      cell: row =>
        finance && row.status === "requested" ? (
          <span className="flex justify-end gap-2">
            <Button size="sm" onClick={() => setPaying(row)}>
              Pay
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setRejecting(row)}>
              Reject
            </Button>
          </span>
        ) : null,
    },
  ];

  return (
    <UdozoShell section="connect" current="/connect/claims" crumbs={[{ label: "Connect", href: "/connect/applications" }, { label: "Claims" }]}>
      <PageHeader title="Claims" description="Sellers claiming what the auction of their abandoned item left over after the storage owed and Udozo's costs." />
      <div className="mt-6">
        <MarketFilter id="claims-market" value={country} onChange={setCountry} />
      </div>
      <Card className="mt-4">
        <CardHeader
          title="Claims"
          description="Check the seller is the item's seller, then pay. Unclaimed money becomes Udozo's once the days end."
          actions={
            <FilterSelect
              id="claims-status"
              label="Status"
              value={status}
              onChange={value => setStatus(value as ConnectAuctionClaim["status"] | "")}
              options={[{ value: "", label: "All" }, ...(Object.keys(statusLabels) as Array<ConnectAuctionClaim["status"]>).map(value => ({ value, label: statusLabels[value] }))]}
            />
          }
        />
        <DataTable<ConnectAuctionClaim> caption="Claims" columns={columns} rows={claims.data?.data} loading={claims.isLoading} error={claims.error ? errorMessage(claims.error) : null} onRetry={claims.refetch} rowKey={row => row.id} empty="No claims." />
      </Card>

      {paying ? (
        <ActionDialog
          open
          onClose={() => setPaying(null)}
          title={`Pay ${paying.number}?`}
          description={`${money(paying.amount, paying.currency)} goes into ${paying.seller.name}'s Udozo money, to pay out to their bank. Say what you checked.`}
          confirmLabel="Pay claim"
          onConfirm={async note => void (await pay({ id: paying.id, note }).unwrap())}
        />
      ) : null}
      {rejecting ? (
        <ActionDialog
          open
          onClose={() => setRejecting(null)}
          title={`Reject ${rejecting.number}?`}
          description="The seller reads why, and may claim again while their days last."
          confirmLabel="Reject claim"
          tone="danger"
          onConfirm={async reason => void (await reject({ id: rejecting.id, reason }).unwrap())}
        />
      ) : null}
    </UdozoShell>
  );
}
