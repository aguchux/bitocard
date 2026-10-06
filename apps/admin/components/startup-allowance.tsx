"use client";

import { useState } from "react";
import { Gift } from "lucide-react";
import { ActionDialog, Button, Card, CardHeader, errorMessage, formatDateTime, formatMoney, KeyValue, Notice, RefreshFailed, Skeleton, StatusBadge } from "@bitocard/admin-ui";
import { can, useAdmin } from "@bitocard/admin-ui/shell";
import { useGrantStartupAllowanceMutation, useResellerWalletQuery, useRevokeStartupAllowanceMutation } from "@bitocard/api-client/admin";

/**
 * The reseller's $500 startup allowance: granted automatically when a verified reseller has the switch on, or here by
 * finance; revoked here (what remains is taken back, never paid out).
 */
export function StartupAllowanceCard({ resellerId, verified, switchedOn }: { resellerId: string; verified: boolean; switchedOn: boolean }) {
  const admin = useAdmin();
  const finance = can(admin, "finance");
  const wallet = useResellerWalletQuery(resellerId);
  const [grant, grantState] = useGrantStartupAllowanceMutation();
  const [revoke] = useRevokeStartupAllowanceMutation();
  const [revoking, setRevoking] = useState(false);
  const allowance = wallet.data?.startup_allowance;

  return (
    <Card>
      <CardHeader
        title="Startup allowance"
        description="US$500, once. Pays only the wholesale cost of customer-paid orders; never cash."
        actions={allowance ? <StatusBadge status={allowance.status} /> : null}
      />
      <div className="space-y-3 px-5 pb-5 sm:px-6">
        {wallet.data && wallet.error && !wallet.isFetching ? <RefreshFailed message={errorMessage(wallet.error)} onRetry={wallet.refetch} /> : null}
        {wallet.isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : !wallet.data && wallet.error ? (
          <Notice tone="red">{errorMessage(wallet.error)}</Notice>
        ) : allowance ? (
          <KeyValue
            items={[
              { label: "Remaining", value: formatMoney(allowance.remaining, "USD") },
              { label: "Granted", value: `${formatMoney(allowance.granted, "USD")} on ${formatDateTime(allowance.granted_at)}` },
              ...(allowance.revoked_at ? [{ label: "Revoked", value: formatDateTime(allowance.revoked_at) }] : []),
            ]}
          />
        ) : (
          <p className="text-sm text-muted">
            {!verified ? "Not granted: the reseller has not passed the identity check." : !switchedOn ? "Not granted: the startup allowance switch is off for this reseller." : "Not granted yet."}
          </p>
        )}
        {grantState.error ? <Notice tone="red">{errorMessage(grantState.error)}</Notice> : null}
        {finance && !wallet.isLoading ? (
          <div className="flex flex-wrap gap-2">
            {!allowance && verified && switchedOn ? (
              <Button size="sm" icon={<Gift className="size-4" aria-hidden />} loading={grantState.isLoading} onClick={() => grant(resellerId)}>
                Grant allowance
              </Button>
            ) : null}
            {allowance && allowance.status !== "revoked" ? (
              <Button size="sm" variant="secondary" onClick={() => setRevoking(true)}>
                Revoke
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      <ActionDialog
        open={revoking}
        onClose={() => setRevoking(false)}
        title="Revoke the startup allowance?"
        description={allowance ? `${formatMoney(allowance.remaining, "USD")} remaining is taken back. It cannot be granted again.` : undefined}
        confirmLabel="Revoke"
        tone="danger"
        requireReason
        onConfirm={reason => revoke({ id: resellerId, reason }).unwrap()}
      />
    </Card>
  );
}
