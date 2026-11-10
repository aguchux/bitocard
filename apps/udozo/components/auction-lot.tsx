"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { payName, shopMoney } from "@bitocard/api-client/classifieds";
import { useConfirm } from "@/components/confirm-dialog";
import { lotCollectionCode, payLot, placeBid } from "@/lib/auction-actions";
import type { AuctionLot } from "@/lib/auctions";
import { fromMinor, toMinor } from "@/lib/shop";

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/**
 * What the visitor can do with a lot: sign in to bid, bid (at least the next step, confirmed: a bid cannot be taken
 * back), pay for a lot won from the Udozo wallet, or show the collection code once paid. The seller of the item does none.
 */
export function LotActions({ lot }: { lot: AuctionLot }) {
  const router = useRouter();
  const path = usePathname();
  const [amount, setAmount] = useState(fromMinor(lot.next_bid));
  const [code, setCode] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ message: string; signIn: boolean } | null>(null);
  const [busy, start] = useTransition();
  const [confirm, dialog] = useConfirm();
  const viewer = lot.viewer;
  const signIn = `/signin?next=${encodeURIComponent(path)}`;

  const run = <T,>(work: () => Promise<{ ok: true; data: T } | { ok: false; message: string; signIn: boolean }>, done?: (data: T) => void) =>
    start(async () => {
      setProblem(null);
      const result = await work();
      if (!result.ok) return setProblem({ message: result.message, signIn: result.signIn });
      done?.(result.data);
      router.refresh();
    });

  const bid = async (event: React.FormEvent) => {
    event.preventDefault();
    const minor = toMinor(amount);
    if (minor === null) return setProblem({ message: "Give your bid.", signIn: false });
    if (lot.next_bid !== null && minor < lot.next_bid) return setProblem({ message: `Bid at least ${shopMoney(lot.next_bid, lot.currency)}.`, signIn: false });
    const answer = await confirm({
      title: `Bid ${shopMoney(minor, lot.currency)}?`,
      body: `If you win, you pay this with ${payName} within ${lot.rules.pay_hours} hours. A bid cannot be taken back.`,
      action: "Place my bid",
      tone: "money",
    });
    if (!answer) return;
    run(() => placeBid(lot.ref, minor), data => setAmount(fromMinor(data.next_bid)));
  };

  const pay = async () => {
    if (!viewer?.to_pay) return;
    const answer = await confirm({
      title: `Pay ${shopMoney(viewer.to_pay.amount, lot.currency)}?`,
      body: `Paid from your Udozo wallet with ${payName}. You then collect it at ${lot.warehouse.name} with your collection code.`,
      action: "Pay now",
      tone: "money",
    });
    if (!answer) return;
    run(() => payLot(lot.ref));
  };

  const showCode = () => run(() => lotCollectionCode(lot.ref), data => setCode(data.code));

  let body: React.ReactNode = null;
  if (viewer?.won) {
    body = code ? (
      <p className="rounded-xl border border-navy-200 p-3 text-center">
        <span className="block text-xs text-navy-600">Your collection code</span>
        <span className="text-2xl font-extrabold tracking-[0.3em] text-navy-900">{code}</span>
        <span className="block text-xs text-navy-600">Give it to Udozo&apos;s team only once the item is in your hands.</span>
      </p>
    ) : (
      <button type="button" onClick={showCode} disabled={busy} className="min-h-11 rounded-xl bg-navy-900 px-4 font-semibold text-white disabled:opacity-60">
        Show my collection code
      </button>
    );
  } else if (viewer?.to_pay) {
    body = (
      <div className="grid gap-1">
        <button type="button" onClick={pay} disabled={busy} className="min-h-11 rounded-xl bg-emerald-700 px-4 font-semibold text-white disabled:opacity-60">
          Pay {shopMoney(viewer.to_pay.amount, lot.currency)}
        </button>
        {viewer.to_pay.pay_by ? <p className="text-xs text-navy-600">Pay by {when(viewer.to_pay.pay_by)}.</p> : null}
      </div>
    );
  } else if (lot.status === "live" && !viewer?.seller) {
    body = viewer ? (
      <form onSubmit={bid} className="grid gap-2">
        <label htmlFor="bid-amount" className="text-sm font-semibold text-navy-900">
          Your bid ({lot.currency})
        </label>
        <input
          id="bid-amount"
          inputMode="decimal"
          value={amount}
          onChange={event => setAmount(event.target.value)}
          className="min-h-11 rounded-xl border border-navy-200 px-3"
          aria-describedby="bid-least"
        />
        {lot.next_bid !== null ? (
          <p id="bid-least" className="text-xs text-navy-600">
            At least {shopMoney(lot.next_bid, lot.currency)}.
          </p>
        ) : null}
        <button type="submit" disabled={busy} className="min-h-11 rounded-xl bg-navy-900 px-4 font-semibold text-white disabled:opacity-60">
          Place bid
        </button>
      </form>
    ) : (
      <Link href={signIn} className="grid min-h-11 place-items-center rounded-xl bg-navy-900 px-4 font-semibold text-white">
        Sign in to bid
      </Link>
    );
  }

  return (
    <>
      {body}
      {problem ? (
        <p className="text-sm text-red-700" role="alert">
          {problem.message}{" "}
          {problem.signIn ? (
            <Link href={signIn} className="font-semibold underline">
              Sign in
            </Link>
          ) : null}
        </p>
      ) : null}
      {dialog}
    </>
  );
}
