"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { type ShopLotShipOptions, type ShopLotTransfer, shopMoney } from "@bitocard/api-client/classifieds";
import { useConfirm } from "@/components/confirm-dialog";
import { cancelLotShip, lotShipOptions, shipLot } from "@/lib/auction-actions";

/** Where a won lot's move to a Connect Centre stands, in one sentence. */
export function lotTransferWords(move: ShopLotTransfer) {
  const to = `${move.to.name}, ${move.to.address}, ${move.to.state}`;
  if (move.status === "paid") return `Udozo is sending it from its warehouse to ${to}. We tell you when it arrives.`;
  if (move.status === "sent") return `On its way to ${to}${move.courier ? ` with ${move.courier}${move.tracking_number ? ` (tracking ${move.tracking_number})` : ""}` : ""}.`;
  if (move.status === "arrived") return `It is at ${to} (${move.to.hours}, ${move.to.phone}). Collect it there with your collection code.`;
  return `Collected at ${move.to.name}.`;
}

/**
 * A won lot of Udozo's, not collected yet: have it sent to a Connect Centre near the buyer (paying the shipping and the
 * centre's Connect fee), or where that move stands, with Stop sending it before Udozo sends it.
 */
export function LotShipping({ lotRef, transfer }: { lotRef: string; transfer: ShopLotTransfer | null }) {
  const router = useRouter();
  const [options, setOptions] = useState<ShopLotShipOptions | null>(null);
  const [chosen, setChosen] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const [confirm, dialog] = useConfirm();
  const moving = transfer && transfer.status !== "collected" ? transfer : null;

  const open = () =>
    start(async () => {
      const result = await lotShipOptions(lotRef);
      if (!result.ok) return setProblem(result.message);
      setProblem(null);
      setOptions(result.data);
    });
  const choice = options?.data.find(option => option.centre.id === chosen);
  const ship = async () => {
    if (!choice || !options) return setProblem("Choose a Connect Centre.");
    const answer = await confirm({
      title: `Send it to ${choice.centre.name}?`,
      body: `You pay ${shopMoney(options.total, options.currency)} now (${shopMoney(options.shipping, options.currency)} shipping and the centre's ${shopMoney(options.fee, options.currency)} Connect fee), from your Udozo money or wallet. You then collect it there with your collection code.`,
      action: "Pay and send it",
      tone: "money",
    });
    if (!answer) return;
    start(async () => {
      const result = await shipLot(lotRef, choice.centre.id, options.total);
      if (!result.ok) return setProblem(result.message);
      router.refresh();
    });
  };
  const cancel = async () => {
    const answer = await confirm({ title: "Stop sending it?", body: "Your money goes back where it came from, and you collect it at Udozo's warehouse instead.", action: "Stop sending it", tone: "danger" });
    if (!answer) return;
    start(async () => {
      const result = await cancelLotShip(lotRef);
      if (!result.ok) return setProblem(result.message);
      router.refresh();
    });
  };

  return (
    <div className="grid gap-2">
      {dialog}
      {moving ? (
        <>
          <p className="rounded-xl bg-navy-50 p-3 text-sm text-navy-900" role="status">
            {moving.number}: {lotTransferWords(moving)}
          </p>
          {moving.status === "paid" ? (
            <button type="button" disabled={busy} onClick={cancel} className="min-h-11 rounded-xl border border-navy-300 px-4 font-semibold text-navy-900 disabled:opacity-60">
              Stop sending it
            </button>
          ) : null}
        </>
      ) : !options ? (
        <button type="button" disabled={busy} onClick={open} className="min-h-11 rounded-xl border border-navy-300 px-4 font-semibold text-navy-900 disabled:opacity-60">
          Have it sent to a Connect Centre near me
        </button>
      ) : options.data.length ? (
        <>
          <label htmlFor={`lot-ship-${lotRef}`} className="text-sm font-semibold text-navy-900">
            Connect Centre to send it to
          </label>
          <select id={`lot-ship-${lotRef}`} value={chosen} onChange={event => setChosen(event.target.value)} className="min-h-11 rounded-xl border border-navy-200 bg-white px-3 text-navy-900">
            <option value="">Choose a centre</option>
            {options.data.map(option => (
              <option key={option.centre.id} value={option.centre.id}>
                {option.centre.state}: {option.centre.name}, {option.centre.area}
              </option>
            ))}
          </select>
          {choice ? (
            <p className="text-sm text-navy-700">
              {choice.centre.address}
              {choice.centre.landmark ? `, ${choice.centre.landmark}` : ""} · {choice.centre.hours}
            </p>
          ) : null}
          <p className="text-xs text-navy-600">
            Shipping {shopMoney(options.shipping, options.currency)} and the centre&apos;s Connect fee {shopMoney(options.fee, options.currency)}.
          </p>
          <button type="button" disabled={busy || !choice} onClick={ship} className="min-h-11 rounded-xl bg-navy-900 px-4 font-semibold text-white disabled:opacity-60">
            Pay {shopMoney(options.total, options.currency)} and send it
          </button>
        </>
      ) : (
        <p className="text-sm text-navy-700">No Connect Centre can take it yet: collect it at the warehouse.</p>
      )}
      {problem ? (
        <p role="alert" className="text-sm font-semibold text-red-700">
          {problem}
        </p>
      ) : null}
    </div>
  );
}
