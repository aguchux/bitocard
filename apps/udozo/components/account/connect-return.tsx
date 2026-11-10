"use client";

import { useState, useTransition } from "react";
import type { ShopConnectReturn } from "@bitocard/api-client/classifieds";
import { useConfirm } from "@/components/confirm-dialog";
import { acceptReturn, returnCode } from "@/lib/shop-actions";

const reasonWords: Record<ShopConnectReturn["reason"], string> = {
  not_collected: "the buyer did not collect it in time",
  refused_at_check_in: "it was refused at check-in",
  refused_at_counter: "the buyer refused it at the counter",
  damaged: "it was damaged",
};
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/**
 * A Connect item going back to its seller: why, and for the seller Accept the return (or it is accepted by itself when
 * nobody answers) and, once accepted, their return code to show at the centre, which takes its Connect fee as the return
 * fee. The buyer reads where it stands.
 */
export function ConnectReturnPanel({ orderId, centreName, seller, item }: { orderId: string; centreName: string; seller: boolean; item: ShopConnectReturn }) {
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
        Return {item.number}: {status === "collected" ? "collected by the seller" : status === "accepted" ? "accepted" : "asked for"}
      </p>
      <p>
        {centreName} is returning it to the seller because {reasonWords[item.reason]}.
      </p>
      {seller && status === "requested" ? (
        <>
          <p className="text-sm">Accept it, or it is accepted by itself on {when(item.answer_by)}.</p>
          <button type="button" disabled={busy} onClick={accept} className="h-11 rounded-xl bg-navy-900 px-4 font-bold text-white disabled:opacity-60">
            Accept the return
          </button>
        </>
      ) : null}
      {seller && status === "accepted" ? (
        <>
          {item.collect_by ? <p className="text-sm">Collect it by {when(item.collect_by)}: after that, storage is charged daily.</p> : null}
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
