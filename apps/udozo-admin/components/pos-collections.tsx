"use client";

import { useState } from "react";
import { ActionDialog, Badge, Button, Card, CardHeader, formatDate, formatDateTime, QueryView, Skeleton } from "@bitocard/admin-ui";
import { can, useAdmin } from "@bitocard/admin-ui/shell";
import { type AdminPosMarketSetting, type AdminPosSettlement, useHoldPosSettlementsMutation, usePosAccountCollectionsQuery, useReleasePosSettlementsMutation } from "@bitocard/api-client/admin";
import { money } from "@/components/connect";

const accountTones = { opening: "amber", active: "green", refused: "red", closed: "grey" } as const;
const accountWords = { opening: "Opening", active: "Open", refused: "Refused", closed: "Closed" } as const;

/** A settlement's state in words: on its way or paid to the bank, or kept in the owner's Udozo payouts and why. */
export function settlementWords(settlement: Pick<AdminPosSettlement, "status" | "kept_reason" | "payout">) {
  if (settlement.status === "kept") return `Kept in their Udozo payouts: ${settlement.kept_reason ?? "no reason recorded"}`;
  if (settlement.payout?.status === "paid") return "Paid to their bank";
  if (settlement.payout?.status === "failed") return "Refused by the bank: back in their Udozo payouts";
  return "On its way to their bank";
}

/**
 * A POS account's Udozo collection accounts (milestone 4): each till's account, what came in and is not yet settled,
 * the settlements, and holding them (fraud, a dispute): collections keep coming in, nothing is paid out while held.
 */
export function PosCollectionsCard({ account }: { account: string }) {
  const admin = useAdmin();
  const query = usePosAccountCollectionsQuery(account);
  const [hold] = useHoldPosSettlementsMutation();
  const [release] = useReleasePosSettlementsMutation();
  const [dialog, setDialog] = useState<"hold" | "release" | null>(null);
  return (
    <Card>
      <CardHeader
        title="Collection accounts"
        description="Bank account numbers for the shop's tills. Transfers into them are paid to the owner's bank the next working day, less Udozo's fee."
        actions={query.data?.held ? <Badge tone="red">Settlements held</Badge> : null}
      />
      <QueryView query={query} loading={<Skeleton className="h-24 w-full" />}>
        {data => (
          <div className="grid gap-4 text-sm">
            <p className="text-ink">
              {money(data.collected, data.currency)} collected, not yet settled · {data.unmatched} not matched to a sale
            </p>
            {data.held ? (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-red-800">
                Held {formatDateTime(data.held.at)}
                {data.held.by ? ` by ${data.held.by}` : ""}: {data.held.reason}
              </p>
            ) : null}
            {data.accounts.length ? (
              <ul className="grid gap-2">
                {data.accounts.map(row => (
                  <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2">
                    <span className="min-w-0">
                      <span className="block font-medium text-ink">
                        {row.till ?? "A removed till"} · {row.bank_name ?? "No bank yet"} {row.account_number ?? ""}
                      </span>
                      <span className="block text-xs text-muted">
                        Asked {formatDate(row.created_at)}
                        {row.attempts > 1 ? `, ${row.attempts} tries` : ""}
                        {row.last_error && row.status !== "active" ? ` · ${row.last_error}` : ""}
                      </span>
                    </span>
                    <Badge tone={accountTones[row.status]}>{accountWords[row.status]}</Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted">No collection accounts asked for.</p>
            )}
            {data.settlements.length ? (
              <>
                <h3 className="font-semibold text-ink">Settlements</h3>
                <ul className="grid gap-1">
                  {data.settlements.map(item => (
                    <li key={item.id} className="flex flex-wrap justify-between gap-2 border-b border-line py-1">
                      <span>
                        {item.number} · {formatDate(item.day)} · {item.collections} transfers
                        <span className="block text-xs text-muted">{settlementWords(item)}</span>
                      </span>
                      <span className="text-muted">
                        {money(item.amount, item.currency)} (fees {money(item.fees, item.currency)})
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {!data.held && can(admin, "finance", "operations") ? (
                <Button variant="secondary" onClick={() => setDialog("hold")}>
                  Hold settlements
                </Button>
              ) : null}
              {data.held && can(admin, "finance") ? (
                <Button variant="secondary" onClick={() => setDialog("release")}>
                  Release the hold
                </Button>
              ) : null}
            </div>
          </div>
        )}
      </QueryView>
      <ActionDialog
        open={dialog === "hold"}
        onClose={() => setDialog(null)}
        title="Hold this owner's settlements?"
        description="Transfers keep coming in and are credited, but nothing is paid to their bank until the hold is released."
        confirmLabel="Hold settlements"
        onConfirm={reason => hold({ account, reason }).unwrap()}
      />
      <ActionDialog
        open={dialog === "release"}
        onClose={() => setDialog(null)}
        title="Release the hold?"
        description="Their collections are settled again from the next working day, the days held included."
        confirmLabel="Release the hold"
        onConfirm={reason => release({ account, reason }).unwrap()}
      />
    </Card>
  );
}

/** Udozo's margin per market in words: 1% (at least ₦50, at most ₦500), on top of the gateway's own fee. */
export function feeWords(row: AdminPosMarketSetting) {
  const parts = [`${(row.collection_fee_bps / 100).toLocaleString("en-GB", { maximumFractionDigits: 2 })}%`];
  const bounds = [row.collection_fee_min ? `at least ${money(row.collection_fee_min, row.currency)}` : null, row.collection_fee_cap !== null ? `at most ${money(row.collection_fee_cap, row.currency)}` : null].filter(Boolean);
  return `${parts[0]}${bounds.length ? ` (${bounds.join(", ")})` : ""} on top of the gateway's fee`;
}
