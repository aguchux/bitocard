"use client";

import { useState } from "react";
import { Ban, Plus, Smartphone } from "lucide-react";
import { ActionDialog, Button, Card, CardHeader, cn, Dialog, errorMessage, formatDateTime, formatMoney, Notice, StatusBadge } from "@bitocard/admin-ui";
import { type Esim, useCancelEsimMutation, useEsimsQuery, useEsimTopUpOptionsQuery, useTopUpEsimMutation } from "@bitocard/api-client/reseller";

const statusLabels: Record<Esim["status"], string> = {
  ready: "Not installed",
  installed: "Installed",
  active: "In use",
  used_up: "Data used up",
  expired: "Expired",
  cancelled: "Cancelled",
  revoked: "Revoked",
  suspended: "Suspended",
};

/** "1.2GB" from bytes. */
const size = (bytes: number) => (bytes >= 1024 ** 3 ? `${Number((bytes / 1024 ** 3).toFixed(1))}GB` : `${Math.round(bytes / 1024 ** 2)}MB`);

function Usage({ esim }: { esim: Esim }) {
  const { total, used } = esim.data;
  if (total === null || used === null) return <p className="text-sm text-muted">{total === null && used !== null ? `${size(used)} used (unlimited)` : "Data use not reported yet."}</p>;
  const share = total > 0 ? Math.min(used / total, 1) : 0;
  return (
    <div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-label="Data used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)}>
        <div className={cn("h-full rounded-full", share > 0.9 ? "bg-amber-500" : "bg-brand-500")} style={{ width: `${share * 100}%` }} />
      </div>
      <p className="mt-1 text-xs text-muted">{`${size(used)} of ${size(total)} used${esim.data.updated_at ? ` · as of ${formatDateTime(esim.data.updated_at)}` : ""}`}</p>
    </div>
  );
}

/** Choose a top-up and pay it from the wallet. */
function TopUpDialog({ esim, open, onClose }: { esim: Esim; open: boolean; onClose: () => void }) {
  const options = useEsimTopUpOptionsQuery(esim.id, { skip: !open });
  const [topUp, state] = useTopUpEsimMutation();
  const [chosen, setChosen] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const list = options.data?.data ?? [];
  const selected = list.find(item => item.id === chosen) ?? list[0];
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Top up this eSIM"
      description="Paid from your wallet at BitoCard's price. Charge your customer as you agree."
      footer={
        done ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              disabled={!selected}
              loading={state.isLoading}
              onClick={async () => {
                const result = await topUp({ id: esim.id, option_id: selected!.id })
                  .unwrap()
                  .catch(() => null);
                if (result) setDone(result.status === "completed" ? "Added." : result.status === "pending" ? "Asked for: it is added as soon as the network confirms." : (result.failure_reason ?? "It could not be added. Nothing was charged."));
              }}
            >
              {selected ? `Pay ${formatMoney(selected.amount, selected.currency)}` : "Top up"}
            </Button>
          </>
        )
      }
    >
      {done ? (
        <Notice tone="green">{done}</Notice>
      ) : options.isLoading ? (
        <p className="text-sm text-muted">Loading top-ups…</p>
      ) : options.error ? (
        <Notice tone="red">{errorMessage(options.error)}</Notice>
      ) : list.length ? (
        <div className="space-y-2">
          {state.error ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
          {list.map(item => (
            <label key={item.id} className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-line p-3 has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50">
              <span className="flex items-center gap-3">
                <input type="radio" name="esim-top-up" checked={selected?.id === item.id} onChange={() => setChosen(item.id)} className="accent-brand-500" />
                <span className="text-sm font-semibold text-ink">{item.name}</span>
              </span>
              <span className="text-sm font-semibold tabular-nums">{formatMoney(item.amount, item.currency)}</span>
            </label>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted">This eSIM takes no top-ups now.</p>
      )}
    </Dialog>
  );
}

/**
 * The order's eSIMs after delivery: each one's status, data use and expiry (read from the network every few hours),
 * a top-up from the wallet, and cancelling the order for a refund while none was installed.
 */
export function EsimsCard({ orderId, canManage }: { orderId: string; canManage: boolean }) {
  const esims = useEsimsQuery({ order_id: orderId });
  const [cancel] = useCancelEsimMutation();
  const [toppingUp, setToppingUp] = useState<Esim | null>(null);
  const [cancelling, setCancelling] = useState<Esim | null>(null);
  const rows = esims.data?.data ?? [];
  if (!rows.length) return null;
  return (
    <Card>
      <CardHeader title="eSIMs" description="Status and data use as the network reports them (every few hours)." />
      <ul className="divide-y divide-line">
        {rows.map((esim, index) => (
          <li key={esim.id} className="space-y-3 p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-2 font-semibold text-ink">
                <Smartphone className="size-4 text-muted" aria-hidden />
                {`eSIM${rows.length > 1 ? ` ${index + 1}` : ""}`}
                <span className="font-mono text-xs font-normal text-muted">{esim.iccid}</span>
              </p>
              <StatusBadge status={esim.status} label={statusLabels[esim.status]} />
            </div>
            <Usage esim={esim} />
            {esim.expires_at ? <p className="text-xs text-muted">{`${esim.status === "ready" ? "Install by" : "Plan ends"} ${formatDateTime(esim.expires_at)}`}</p> : null}
            {canManage ? (
              <div className="flex flex-wrap gap-2">
                {esim.top_ups !== "none" && ["ready", "installed", "active", "used_up"].includes(esim.status) ? (
                  <Button size="sm" variant="secondary" icon={<Plus className="size-4" aria-hidden />} onClick={() => setToppingUp(esim)}>
                    Top up
                  </Button>
                ) : null}
                {esim.cancellable ? (
                  <Button size="sm" variant="ghost" icon={<Ban className="size-4" aria-hidden />} onClick={() => setCancelling(esim)}>
                    Cancel for a refund
                  </Button>
                ) : null}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {toppingUp ? <TopUpDialog esim={toppingUp} open onClose={() => setToppingUp(null)} /> : null}
      <ActionDialog
        open={Boolean(cancelling)}
        onClose={() => setCancelling(null)}
        title="Cancel and refund this order?"
        description="Every eSIM of this order is cancelled (none was installed) and the order refunded: to your wallet, or to your store's customer."
        confirmLabel="Cancel and refund"
        tone="danger"
        requireReason={false}
        onConfirm={async () => {
          await cancel(cancelling!.id).unwrap();
          setCancelling(null);
        }}
      />
    </Card>
  );
}
