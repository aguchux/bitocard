"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { type ShopConnectAuction, type ShopConnectReturn, type ShopReturnShipOption, type ShopReturnTransfer, shopMoney } from "@bitocard/api-client/classifieds";
import { useConfirm } from "@/components/confirm-dialog";
import { acceptReturn, cancelReturnShip, claimAuction, payStorage, returnCode, returnShipOptions, shipReturn } from "@/lib/shop-actions";

const reasonWords: Record<ShopConnectReturn["reason"], string> = {
  not_collected: "the buyer did not collect it in time",
  refused_at_check_in: "it was refused at check-in",
  refused_at_counter: "the buyer refused it at the counter",
  damaged: "it was damaged",
};
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** Where an abandoned item is, and where its seller collects it. */
export function placeWords(item: Pick<ShopConnectReturn, "place" | "warehouse">, centreName: string) {
  if (item.place === "auctioned") return "Abandoned and sold at a Udozo auction to pay the storage owed.";
  if (item.place === "udozo_warehouse" && item.warehouse) return `Abandoned: it is at ${item.warehouse.name}, ${item.warehouse.address}, ${item.warehouse.state} (${item.warehouse.hours}, ${item.warehouse.phone}). Collect it there after paying what is owed, before Udozo auctions it.`;
  if (item.place === "in_transit") return "Abandoned: Udozo has collected it and is taking it to its warehouse.";
  return `Abandoned: it waits at ${centreName} for Udozo's pickup to its warehouse. You can still collect it there after paying what is owed.`;
}

/** Where a return sent on to a centre near its seller stands, in one sentence. */
export function transferWords(move: ShopReturnTransfer, holding: string) {
  const to = `${move.to.name}, ${move.to.address}, ${move.to.state}`;
  if (move.status === "paid") return `Waiting for ${holding} to send it to ${to}. Your days to collect start again when it arrives.`;
  if (move.status === "sent") return `On its way to ${to}${move.courier ? ` with ${move.courier}${move.tracking_number ? ` (tracking ${move.tracking_number})` : ""}` : ""}.`;
  if (move.status === "arrived") return `It is at ${to} (${move.to.hours}, ${move.to.phone}). Collect it there with your return code.`;
  return `Collected at ${move.to.name}.`;
}

/** Whether the seller can still have it sent on: accepted, at a centre, not moving, and within its free days. */
export const canShip = (item: ShopConnectReturn, now = Date.now()) =>
  item.status === "accepted" && !item.abandoned_at && (!item.place || item.place === "centre") && !(item.transfer && item.transfer.status !== "collected") && !!item.collect_by && new Date(item.collect_by).getTime() > now;

/** Choosing a Connect Centre near them to have their return sent to, with its shipping, then paying for it. */
function SendItOn({ orderId, holding }: { orderId: string; holding: string }) {
  const router = useRouter();
  const [options, setOptions] = useState<{ currency: string; data: ShopReturnShipOption[] } | null>(null);
  const [chosen, setChosen] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const [confirm, dialog] = useConfirm();
  const open = () =>
    start(async () => {
      const result = await returnShipOptions(orderId);
      if (!result.ok) return setProblem(result.message);
      setProblem(null);
      setOptions(result.data);
    });
  const choice = options?.data.find(option => option.centre.id === chosen);
  const ship = async () => {
    if (!choice || !options) return setProblem("Choose a Connect Centre.");
    const answer = await confirm({
      title: `Send it to ${choice.centre.name}?`,
      body: `You pay ${shopMoney(choice.shipping, options.currency)} for the shipping now, from your Udozo money or wallet. ${holding} sends it there; you collect it with your return code and pay that centre's return fee.`,
      action: "Pay and send it",
      tone: "money",
    });
    if (!answer) return;
    start(async () => {
      const result = await shipReturn(orderId, choice.centre.id, choice.shipping);
      if (!result.ok) return setProblem(result.message);
      router.refresh();
    });
  };
  return (
    <div className="grid gap-2">
      {dialog}
      {!options ? (
        <button type="button" disabled={busy} onClick={open} className="h-11 rounded-xl border border-navy-300 bg-white px-4 font-bold text-navy-900 disabled:opacity-60">
          Send it to a centre near me
        </button>
      ) : options.data.length ? (
        <>
          <label htmlFor={`ship-${orderId}`} className="text-sm font-semibold">
            Connect Centre to send it to
          </label>
          <select id={`ship-${orderId}`} value={chosen} onChange={event => setChosen(event.target.value)} className="h-11 rounded-xl border border-amber-300 bg-white px-3 text-navy-900">
            <option value="">Choose a centre</option>
            {options.data.map(option => (
              <option key={option.centre.id} value={option.centre.id}>
                {option.centre.state}: {option.centre.name}, {option.centre.area} ({shopMoney(option.shipping, options.currency)})
              </option>
            ))}
          </select>
          {choice ? (
            <p className="text-sm">
              {choice.centre.address}
              {choice.centre.landmark ? `, ${choice.centre.landmark}` : ""} · {choice.centre.hours}
            </p>
          ) : null}
          <button type="button" disabled={busy || !choice} onClick={ship} className="h-11 rounded-xl bg-navy-900 px-4 font-bold text-white disabled:opacity-60">
            {choice ? `Pay ${shopMoney(choice.shipping, options.currency)} and send it` : "Pay and send it"}
          </button>
        </>
      ) : (
        <p className="text-sm">No other Connect Centre can take it yet: collect it at {holding}.</p>
      )}
      {problem ? (
        <p role="alert" className="text-sm font-semibold text-brand-700">
          {problem}
        </p>
      ) : null}
    </div>
  );
}

/**
 * A Connect item going back to its seller: why, and for the seller Accept the return (or it is accepted by itself when
 * nobody answers) and, once accepted, their return code to show at the centre, which takes its Connect fee as the return
 * fee. The buyer reads where it stands.
 */
export function ConnectReturnPanel({ orderId, centreName, seller, item, currency = "NGN" }: { orderId: string; centreName: string; seller: boolean; item: ShopConnectReturn; currency?: string }) {
  const router = useRouter();
  const [status, setStatus] = useState(item.status);
  const [code, setCode] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const [confirm, dialog] = useConfirm();
  const accept = async () => {
    const answer = await confirm({
      title: "Accept the return?",
      body: `You collect it from ${centreName} with your return code, paying the centre's Connect fee as the return fee.`,
      action: "Accept the return",
    });
    if (!answer) return;
    start(async () => {
      const result = await acceptReturn(orderId);
      if (result.ok) {
        setStatus("accepted");
        setProblem(null);
      } else setProblem(result.message);
    });
  };
  return (
    <div className="grid gap-2 rounded-xl bg-amber-50 p-3 text-amber-950">
      {dialog}
      <p className="font-semibold">
        Return {item.number}: {status === "collected" ? "collected by the seller" : item.place === "auctioned" ? "ended at auction" : status === "accepted" ? "accepted" : status === "cancelled" ? "ended" : "asked for"}
      </p>
      <p>
        {centreName} is returning it to the seller because {reasonWords[item.reason]}.
      </p>
      {item.abandoned_at && status !== "collected" ? <p className="text-sm font-semibold">{placeWords(item, centreName)}</p> : null}
      {seller && status === "requested" ? (
        <>
          <p className="text-sm">Accept it, or it is accepted by itself on {when(item.answer_by)}.</p>
          <button type="button" disabled={busy} onClick={accept} className="h-11 rounded-xl bg-navy-900 px-4 font-bold text-white disabled:opacity-60">
            Accept the return
          </button>
        </>
      ) : null}
      {seller && item.transfer && item.transfer.status !== "collected" ? (
        <div className="grid gap-2">
          <p className="text-sm font-semibold">
            {item.transfer.number}: {transferWords(item.transfer, centreName)}
          </p>
          {item.transfer.status === "paid" ? (
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                const answer = await confirm({ title: "Keep it where it is?", body: `The ${shopMoney(item.transfer!.shipping, currency)} shipping goes back to you, and you collect it at ${centreName}.`, action: "Cancel sending it" });
                if (!answer) return;
                start(async () => {
                  const result = await cancelReturnShip(orderId);
                  if (result.ok) router.refresh();
                  else setProblem(result.message);
                });
              }}
              className="h-11 rounded-xl border border-amber-300 bg-white px-4 font-bold text-navy-900 disabled:opacity-60"
            >
              Cancel sending it
            </button>
          ) : null}
        </div>
      ) : null}
      {seller && status === "accepted" ? (
        <>
          {item.collect_by && !item.abandoned_at ? <p className="text-sm">Collect it by {when(item.collect_by)}: after that, storage is charged daily.</p> : null}
          {canShip({ ...item, status }) ? <SendItOn orderId={orderId} holding={centreName} /> : null}
          {code ? (
            <p aria-label={`Return code ${code.split("").join(" ")}`} className="text-center font-mono text-3xl font-extrabold tracking-[0.3em]">
              {code}
            </p>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                start(async () => {
                  const result = await returnCode(orderId);
                  if (result.ok) setCode(result.data.code);
                  else setProblem(result.message);
                })
              }
              className="h-11 rounded-xl bg-navy-900 px-4 font-bold text-white disabled:opacity-60"
            >
              Show my return code
            </button>
          )}
          <p className="text-xs">Give it to the centre&apos;s staff only when you collect the item.</p>
        </>
      ) : null}
      {problem ? (
        <p role="alert" className="text-sm font-semibold text-brand-700">
          {problem}
        </p>
      ) : null}
    </div>
  );
}

/** Storage the buyer owes before they collect it: what it is, and Pay storage from their wallet. */
/** Where the seller's claim to what an auction left over stands, in one sentence. */
export function claimWords(auction: ShopConnectAuction, currency: string, now = Date.now()) {
  const left = auction.left_over ?? 0;
  const amount = shopMoney(left, currency);
  if (auction.claim?.status === "paid") return `Your claim ${auction.claim.number} was paid: ${shopMoney(auction.claim.amount, currency)} is in your Udozo money.`;
  if (auction.claim?.status === "requested") return `Your claim ${auction.claim.number} for ${amount} is with Udozo.`;
  if (auction.unclaimed_at) return `${amount} was left over, but it was not claimed in time, so it is now Udozo's.`;
  if (left <= 0) return "Its sale paid what it could of the storage owed. Nothing is left over.";
  const open = !auction.claim_by || new Date(auction.claim_by).getTime() > now;
  if (!open) return `The days to claim the ${amount} left over have passed.`;
  const rejected = auction.claim?.status === "rejected" ? `Your claim was not paid${auction.claim.decision_note ? `: ${auction.claim.decision_note}` : "."} ` : "";
  return `${rejected}${amount} is left over for you after the storage owed. Claim it${auction.claim_by ? ` by ${when(auction.claim_by)}` : ""}, or it becomes Udozo's.`;
}

/** Can the seller claim now: something left over, not claimed or paid, and within the days. */
export const canClaim = (auction: ShopConnectAuction, now = Date.now()) =>
  (auction.left_over ?? 0) > 0 && !auction.unclaimed_at && auction.claim?.status !== "requested" && auction.claim?.status !== "paid" && (!auction.claim_by || new Date(auction.claim_by).getTime() > now);

/** The seller's view of their abandoned item's auction: what it raised, and claiming what was left over. */
export function AuctionClaim({ orderId, auction, currency }: { orderId: string; auction: ShopConnectAuction; currency: string }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const [confirm, dialog] = useConfirm();
  const claim = async () => {
    const answer = await confirm({ title: `Claim ${shopMoney(auction.left_over ?? 0, currency)}?`, body: "Udozo checks your claim, then pays it into your Udozo money to pay out to your bank.", action: "Claim it", tone: "money" });
    if (!answer) return;
    start(async () => {
      const result = await claimAuction(orderId, note);
      if (result.ok) router.refresh();
      else setProblem(result.message);
    });
  };
  return (
    <div className="grid gap-2 rounded-xl bg-navy-50 p-3 text-navy-900">
      <p className="font-semibold">
        Sold at Udozo auction {auction.number}
        {auction.sale !== null ? ` for ${shopMoney(auction.sale, currency)}` : ""}
      </p>
      <p className="text-sm">{claimWords(auction, currency)}</p>
      {canClaim(auction) ? (
        <>
          <label htmlFor="claim-note" className="text-sm font-semibold">
            Anything Udozo should know (optional)
          </label>
          <textarea id="claim-note" value={note} onChange={event => setNote(event.target.value)} maxLength={500} rows={2} className="rounded-xl border border-navy-200 bg-white p-2" />
          <button type="button" disabled={busy} onClick={claim} className="h-11 rounded-xl bg-emerald-700 px-4 font-bold text-white disabled:opacity-60">
            Claim what is left over
          </button>
        </>
      ) : null}
      {problem ? (
        <p role="alert" className="text-sm font-semibold text-brand-700">
          {problem}
        </p>
      ) : null}
      {dialog}
    </div>
  );
}

export function PayStorage({ orderId, owed, currency }: { orderId: string; owed: number; currency: string }) {
  const router = useRouter();
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, start] = useTransition();
  return (
    <div className="grid gap-2 rounded-xl bg-amber-50 p-3 text-amber-950">
      <p className="font-semibold">Storage to pay: {shopMoney(owed, currency)}</p>
      <p className="text-sm">Your free time to collect it is over, so storage is charged daily. Pay it before you collect it.</p>
      <button
        type="button"
        disabled={busy}
        onClick={() =>
          start(async () => {
            const result = await payStorage(orderId);
            if (result.ok) router.refresh();
            else setProblem(result.message);
          })
        }
        className="h-11 rounded-xl bg-navy-900 px-4 font-bold text-white disabled:opacity-60"
      >
        Pay storage
      </button>
      {problem ? (
        <p role="alert" className="text-sm font-semibold text-brand-700">
          {problem}
        </p>
      ) : null}
    </div>
  );
}
