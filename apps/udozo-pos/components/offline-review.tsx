"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useConfirm } from "@/components/confirm-dialog";
import { flagText, methodLabel, money, type PosFlaggedSale, type PosOfflineHeld, saleTime } from "@/lib/pos";
import { decideHeld, importOfflineFile, resolveFlags } from "@/lib/pos-actions";

/**
 * A sale rung up offline with something to look at (milestone 9): what happened in words, and **Mark as looked at**
 * once the stock is put right (a count, a restock or a move).
 */
export function FlaggedSale({ sale, canResolve }: { sale: PosFlaggedSale; canResolve: boolean }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <li className="grid gap-2 rounded-xl border border-pos-line p-3">
      <span className="flex flex-wrap items-baseline justify-between gap-2">
        <a href={`/app/sales/${sale.id}`} className="font-semibold">
          {sale.number}
          {sale.client_number ? <span className="font-normal text-pos-muted"> (receipt {sale.client_number})</span> : null}
        </a>
        <span className="font-display font-bold text-pos-ink">{money(sale.total, sale.currency)}</span>
      </span>
      <span className="text-sm text-pos-muted">
        {sale.till} · {sale.sold_by} · sold {saleTime(sale.sold_at)}
        {sale.uploaded_at ? `, uploaded ${saleTime(sale.uploaded_at)}` : ""}
      </span>
      <ul className="grid gap-1 text-sm text-pos-ink-2">
        {sale.flags.map((flag, index) => (
          <li key={index}>{flagText(flag, sale.currency)}</li>
        ))}
      </ul>
      {sale.resolved_at ? (
        <span className="text-sm font-semibold text-pos-700">
          Looked at by {sale.resolved_by}, {saleTime(sale.resolved_at)}
        </span>
      ) : canResolve ? (
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const result = await resolveFlags(sale.id);
              if (!result.ok) return setMessage(result.message);
              router.refresh();
            })
          }
          className="h-10 w-fit rounded-xl border border-pos-line bg-white px-4 text-sm font-semibold disabled:opacity-60"
        >
          Mark as looked at<span className="sr-only">: {sale.number}</span>
        </button>
      ) : null}
      {message ? (
        <p role="alert" className="text-sm font-semibold text-pos-error">
          {message}
        </p>
      ) : null}
    </li>
  );
}

/** A sale an unlinked device uploaded: the owner accepts it (it becomes a sale) or rejects it. */
export function HeldSale({ held, currency }: { held: PosOfflineHeld; currency: string }) {
  const router = useRouter();
  const [confirm, dialog] = useConfirm();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const decide = async (decision: "accept" | "reject") => {
    const ok = await confirm(
      decision === "accept"
        ? { title: "Accept this sale?", body: <p>It becomes a sale at {held.device.till ?? "its till"}, its stock taken, marked as from a device you unlinked.</p>, action: "Accept the sale" }
        : { title: "Reject this sale?", body: <p>Nothing is recorded and no stock is taken. Do this only if the sale never happened.</p>, action: "Reject it", tone: "danger" },
    );
    if (!ok) return;
    start(async () => {
      const result = await decideHeld(held.id, decision);
      if (!result.ok) return setMessage(result.message);
      router.refresh();
    });
  };
  return (
    <li className="grid gap-2 rounded-xl border border-pos-line p-3">
      <span className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-semibold text-pos-ink">
          {held.client_number ? `Receipt ${held.client_number}` : "A sale"} · {held.items} {held.items === 1 ? "item" : "items"}
        </span>
        <span className="font-display font-bold text-pos-ink">{money(held.total, currency)}</span>
      </span>
      <span className="text-sm text-pos-muted">
        {held.device.name ?? "A device"}
        {held.device.till ? ` at ${held.device.till}` : ""} · sold {saleTime(held.sold_at)} · {held.payments.map(payment => methodLabel(payment.method as never)).join(", ")}
      </span>
      {held.status === "held" ? (
        <span className="flex flex-wrap gap-2">
          <button type="button" disabled={pending} onClick={() => decide("accept")} className="h-10 rounded-xl bg-pos-600 px-4 text-sm font-bold text-white disabled:opacity-60">
            Accept
          </button>
          <button type="button" disabled={pending} onClick={() => decide("reject")} className="h-10 rounded-xl border border-pos-line bg-white px-4 text-sm font-semibold disabled:opacity-60">
            Reject
          </button>
        </span>
      ) : (
        <span className="text-sm font-semibold text-pos-ink-2">
          {held.status === "accepted" ? "Accepted" : "Rejected"} by {held.decided_by}
        </span>
      )}
      {message ? (
        <p role="alert" className="text-sm font-semibold text-pos-error">
          {message}
        </p>
      ) : null}
      {dialog}
    </li>
  );
}

/**
 * A file of a till's unsent sales (saved on the till with **Save unsent to a file**), uploaded from here: Udozo checks
 * it was signed by that till and applies each sale and step once, so a file uploaded twice, or after the till synced,
 * changes nothing more.
 */
export function ImportUnsent() {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="grid gap-2">
      <label className="grid max-w-md gap-1 text-sm font-semibold text-pos-ink-2">
        File of unsent sales
        <input
          type="file"
          accept="application/json,.json"
          disabled={pending}
          onChange={event => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            if (file.size > 4_000_000) return setMessage("That file is too big to upload here. Upload the till's sales from the till once it is online.");
            start(async () => {
              const result = await importOfflineFile(await file.text());
              if (!result.ok) return setMessage(result.message);
              const count = (status: string) => result.data.results.filter(row => row.status === status).length;
              const refused = result.data.results.filter(row => row.status === "rejected");
              setMessage(`${result.data.device.name ?? "The till"}: ${count("applied")} applied, ${count("duplicate")} already in, ${count("held")} held, ${refused.length} refused${refused.length ? ` (${refused[0]!.error?.message ?? "refused"})` : ""}.`);
              router.refresh();
            });
          }}
          className="text-sm font-normal"
        />
      </label>
      {message ? (
        <p role="status" className="text-sm font-semibold text-pos-ink">
          {message}
        </p>
      ) : null}
    </div>
  );
}
