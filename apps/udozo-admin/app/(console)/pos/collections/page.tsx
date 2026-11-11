"use client";

import { useId, useState } from "react";
import { ActionDialog, Badge, Button, Card, CardHeader, Field, formatDateTime, Input, PageHeader, QueryView, Skeleton } from "@bitocard/admin-ui";
import { AppLink, can, useAdmin } from "@bitocard/admin-ui/shell";
import { type AdminPosCollection, type AdminPosMarketSetting, usePosCollectionsQuery, usePosMarketSettingsQuery, useSetPosMarketSettingsMutation } from "@bitocard/api-client/admin";
import { money } from "@/components/connect";
import { feeWords } from "@/components/pos-collections";
import { UdozoShell } from "@/components/shell";

const statusTones = { matched: "green", unmatched: "amber", kept: "grey" } as const;
const statusWords = { matched: "Paid a sale", unmatched: "Not matched", kept: "Kept" } as const;
const filters = [
  { value: "", label: "All" },
  { value: "unmatched", label: "Not matched" },
  { value: "matched", label: "Paid a sale" },
  { value: "kept", label: "Kept" },
] as const;

function EditFee({ row, onClose }: { row: AdminPosMarketSetting; onClose: () => void }) {
  const id = useId();
  const [percent, setPercent] = useState(String(row.collection_fee_bps / 100));
  const [min, setMin] = useState(String(row.collection_fee_min / 100));
  const [cap, setCap] = useState(row.collection_fee_cap === null ? "" : String(row.collection_fee_cap / 100));
  const [save] = useSetPosMarketSettingsMutation();
  return (
    <ActionDialog
      open
      onClose={onClose}
      title={`Collection fee in ${row.name}`}
      description="Udozo's margin on each transfer into a till's collection account, on top of what the gateway charges. New transfers pay it; past ones keep theirs."
      confirmLabel="Save the fee"
      requireReason={false}
      onConfirm={async () => {
        const bps = Math.round(Number(percent) * 100);
        const minMinor = Math.round(Number(min || "0") * 100);
        const capMinor = cap.trim() === "" ? null : Math.round(Number(cap) * 100);
        if (!Number.isFinite(bps) || bps < 0 || bps > 1000) throw new Error("The margin is 0% to 10%.");
        if (!Number.isFinite(minMinor) || minMinor < 0 || (capMinor !== null && (!Number.isFinite(capMinor) || capMinor < minMinor))) throw new Error("The cap must be at least the minimum.");
        await save({ country: row.country, collection_fee_bps: bps, collection_fee_min: minMinor, collection_fee_cap: capMinor }).unwrap();
      }}
    >
      <div className="grid gap-3">
        <Field label="Margin (%)" htmlFor={`${id}-bps`}>
          <Input id={`${id}-bps`} inputMode="decimal" value={percent} onChange={event => setPercent(event.target.value)} />
        </Field>
        <Field label={`At least (${row.currency})`} htmlFor={`${id}-min`}>
          <Input id={`${id}-min`} inputMode="decimal" value={min} onChange={event => setMin(event.target.value)} />
        </Field>
        <Field label={`At most (${row.currency})`} htmlFor={`${id}-cap`} hint="Empty for no cap.">
          <Input id={`${id}-cap`} inputMode="decimal" value={cap} onChange={event => setCap(event.target.value)} />
        </Field>
      </div>
    </ActionDialog>
  );
}

function Transfer({ item }: { item: AdminPosCollection }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 text-sm">
      <span className="min-w-0">
        <span className="block font-medium text-ink">
          {money(item.amount, item.currency)} from {item.payer_name ?? "an unnamed account"}
          {item.mode === "test" ? <span className="text-muted"> · sandbox</span> : null}
        </span>
        <span className="block text-xs text-muted">
          {item.number} · {item.account ? <AppLink href={`/pos/accounts/${item.account.id}`}>{item.account.shop ?? "A shop"}</AppLink> : null}
          {item.till ? `, ${item.till.name}` : ""} · {formatDateTime(item.received_at)} · fee {money(item.fee, item.currency)}
          {item.sale ? ` · ${item.sale.number}` : ""}
          {item.settlement ? ` · ${item.settlement.number}` : ""}
        </span>
      </span>
      <Badge tone={statusTones[item.status]}>{statusWords[item.status]}</Badge>
    </li>
  );
}

/**
 * Udozo POS collections (milestone 4): every transfer into tills' collection accounts with its fee and what it paid, and
 * Udozo's collection fee per market (finance). Holding an owner's settlements is on their account's page.
 */
export default function PosCollectionsPage() {
  const admin = useAdmin();
  const [status, setStatus] = useState<"" | AdminPosCollection["status"]>("");
  const collections = usePosCollectionsQuery(status ? { status } : undefined);
  const markets = usePosMarketSettingsQuery();
  const [editing, setEditing] = useState<AdminPosMarketSetting | null>(null);
  return (
    <UdozoShell section="pos" current="/pos/collections" crumbs={[{ label: "POS", href: "/pos/accounts" }, { label: "Collections" }]}>
      <PageHeader title="Collections" description="Transfers into shops' collection accounts, paid to owners' banks the next working day, less Udozo's fee." />
      <div className="mt-6 grid gap-4">
        <Card>
          <CardHeader title="Transfers" />
          <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="Show">
            {filters.map(filter => (
              <Button key={filter.value} variant={status === filter.value ? "primary" : "secondary"} onClick={() => setStatus(filter.value)} aria-pressed={status === filter.value}>
                {filter.label}
              </Button>
            ))}
          </div>
          <QueryView query={collections} loading={<Skeleton className="h-40 w-full" />}>
            {list => (
              <>
                {list.totals.length ? (
                  <p className="mb-3 text-sm text-muted">
                    {list.totals.map(total => `${money(total.amount, total.currency)} in, ${money(total.fees, total.currency)} fees${total.mode === "test" ? " (sandbox)" : ""}`).join(" · ")}
                  </p>
                ) : null}
                {list.data.length ? (
                  <ul className="grid gap-2">
                    {list.data.map(item => (
                      <Transfer key={item.id} item={item} />
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted">No transfers{status ? " here" : " yet"}.</p>
                )}
              </>
            )}
          </QueryView>
        </Card>
        <Card>
          <CardHeader title="Collection fee per market" description="Udozo's margin on each transfer, on top of the gateway's own fee. Finance sets it." />
          <QueryView query={markets} loading={<Skeleton className="h-24 w-full" />}>
            {list => (
              <ul className="grid gap-2 text-sm">
                {list.data.map(row => (
                  <li key={row.country} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2">
                    <span>
                      <span className="block font-medium text-ink">{row.name}</span>
                      <span className="block text-xs text-muted">{feeWords(row)}</span>
                    </span>
                    {can(admin, "finance") ? (
                      <Button variant="secondary" onClick={() => setEditing(row)}>
                        Change
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </QueryView>
        </Card>
      </div>
      {editing ? <EditFee row={editing} onClose={() => setEditing(null)} /> : null}
    </UdozoShell>
  );
}
