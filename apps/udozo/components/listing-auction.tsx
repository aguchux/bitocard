"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Gavel } from "lucide-react";
import { payName, type ShopListingAuction, shopMoney } from "@bitocard/api-client/classifieds";
import { useConfirm } from "@/components/confirm-dialog";
import { bidOnListing, lotCollectionCode, payLot } from "@/lib/auction-actions";
import { timeLeft } from "@/lib/auctions";
import { fromMinor, toMinor } from "@/lib/shop";

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** What the reader's place in the auction is, in one sentence (null: nothing to say). */
export function auctionNote(auction: ShopListingAuction, currency: string) {
  const viewer = auction.viewer;
  if (viewer?.seller) return auction.status === "live" ? "Your listing is at auction: it sells to the highest bid at or above your reserve." : null;
  const udozos = auction.kind === "abandoned";
  if (viewer?.won) return udozos ? "You bought it at auction. Show your collection code at the warehouse to collect it." : "You bought it at auction.";
  if (viewer?.to_pay) {
    const by = viewer.to_pay.pay_by ? ` by ${when(viewer.to_pay.pay_by)}` : "";
    return `You won it at ${shopMoney(viewer.to_pay.amount, currency)}. Pay ${udozos ? "from your Udozo wallet" : `with ${payName}`}${by}, or it goes to the next bidder.`;
  }
  if (auction.status === "live" && viewer?.leading) return "You are the highest bidder.";
  if (auction.status === "live" && viewer?.highest) return "You were outbid.";
  return null;
}

/** Where the auction stands, in words: open with time left, waiting for the winner, sold or not sold. */
export function auctionState(auction: ShopListingAuction, now = Date.now()) {
  if (auction.status === "scheduled") return `Bidding opens ${when(auction.starts_at)}`;
  if (auction.status === "live") return `Ends in ${timeLeft(auction.ends_at, now)} (${when(auction.ends_at)})`;
  if (auction.status === "awaiting_payment") return "Bidding has ended: the winner is paying.";
  if (auction.status === "sold") return "Sold at auction.";
  if (auction.status === "unsold") return "The auction ended without a sale.";
  return "This auction was withdrawn.";
}

/**
 * A listing sold by auction, on its page: the price to beat, how many bids and when it ends, the reserve's state, the
 * latest bids, and bidding (signed in with a confirmed mobile, at least the next step, confirmed first: a bid cannot be
 * taken back). A seller's winner pays through the listing's UdozoPay button; a lot of Udozo's (an abandoned item) is
 * paid here from the wallet and collected at Udozo's warehouse with a code.
 */
export function AuctionPanel({ listingId, currency, auction, signedIn, phoneConfirmed }: { listingId: string; currency: string; auction: ShopListingAuction; signedIn: boolean; phoneConfirmed: boolean }) {
  const router = useRouter();
  const path = usePathname();
  const [amount, setAmount] = useState(fromMinor(auction.next_bid));
  const [problem, setProblem] = useState<{ message: string; signIn: boolean } | null>(null);
  const [busy, start] = useTransition();
  const [code, setCode] = useState<string | null>(null);
  const [confirm, dialog] = useConfirm();
  const viewer = auction.viewer;
  const note = auctionNote(auction, currency);
  const signIn = `/signin?next=${encodeURIComponent(path)}`;

  const bid = async (event: React.FormEvent) => {
    event.preventDefault();
    const minor = toMinor(amount);
    if (minor === null) return setProblem({ message: "Give your bid.", signIn: false });
    if (auction.next_bid !== null && minor < auction.next_bid) return setProblem({ message: `Bid at least ${shopMoney(auction.next_bid, currency)}.`, signIn: false });
    const answer = await confirm({
      title: `Bid ${shopMoney(minor, currency)}?`,
      body: `If you win, you pay this ${auction.kind === "abandoned" ? "from your Udozo wallet" : `with ${payName}`} within ${auction.rules.pay_hours} hours. A bid cannot be taken back.`,
      action: "Place my bid",
      tone: "money",
    });
    if (!answer) return;
    start(async () => {
      setProblem(null);
      const result = await bidOnListing(listingId, minor);
      if (!result.ok) return setProblem({ message: result.message, signIn: result.signIn });
      setAmount(fromMinor(result.data.next_bid));
      router.refresh();
    });
  };

  const pay = async () => {
    if (!viewer?.to_pay) return;
    const answer = await confirm({
      title: `Pay ${shopMoney(viewer.to_pay.amount, currency)}?`,
      body: "It is taken from your Udozo wallet. You then collect the item at Udozo's warehouse with your code.",
      action: "Pay from my wallet",
      tone: "money",
    });
    if (!answer) return;
    start(async () => {
      setProblem(null);
      const result = await payLot(auction.ref);
      if (!result.ok) return setProblem({ message: result.message, signIn: result.signIn });
      router.refresh();
    });
  };

  const showCode = () =>
    start(async () => {
      setProblem(null);
      const result = await lotCollectionCode(auction.ref);
      if (!result.ok) return setProblem({ message: result.message, signIn: result.signIn });
      setCode(result.data.collected_at ? "collected" : result.data.code);
    });

  return (
    <section aria-labelledby="auction-heading" className="grid gap-3 rounded-2xl border-2 border-navy-900 bg-white p-4">
      <h2 id="auction-heading" className="flex items-center gap-2 text-sm font-bold text-navy-900">
        <Gavel className="size-4" aria-hidden="true" /> Auction {auction.number}
      </h2>
      <div>
        <p className="text-xs text-navy-600">{auction.current_price === null ? "Starting price" : "Highest bid"}</p>
        <p className="text-2xl font-extrabold text-navy-900">{shopMoney(auction.current_price ?? auction.start_price, currency)}</p>
        <p className="text-sm text-navy-700">
          {auction.bids} {auction.bids === 1 ? "bid" : "bids"} · {auctionState(auction)}
        </p>
        {auction.reserve_met !== null ? <p className="text-xs font-semibold text-navy-700">{auction.reserve_met ? "Reserve met" : "Reserve not met"}</p> : null}
      </div>
      {note ? (
        <p className="rounded-xl bg-navy-50 p-3 text-sm font-semibold text-navy-900" role="status">
          {note}
        </p>
      ) : null}
      {auction.kind === "abandoned" && viewer?.to_pay && auction.status === "awaiting_payment" ? (
        <button type="button" onClick={pay} disabled={busy} className="min-h-11 rounded-xl bg-navy-900 px-4 font-semibold text-white disabled:opacity-60">
          Pay {shopMoney(viewer.to_pay.amount, currency)} from your wallet
        </button>
      ) : null}
      {auction.kind === "abandoned" && viewer?.won ? (
        code === "collected" ? (
          <p className="text-sm font-semibold text-navy-900">You have collected it.</p>
        ) : code ? (
          <p className="rounded-xl border border-navy-200 p-3 text-center" role="status">
            <span className="block text-xs text-navy-600">Your collection code</span>
            <span className="text-2xl font-extrabold tracking-widest text-navy-900">{code}</span>
          </p>
        ) : (
          <button type="button" onClick={showCode} disabled={busy} className="min-h-11 rounded-xl border border-navy-300 px-4 font-semibold text-navy-900 disabled:opacity-60">
            Show my collection code
          </button>
        )
      ) : null}
      {auction.kind === "abandoned" && auction.warehouse ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
          Sold by Udozo as seen, from a shipment nobody collected: Udozo has not tested it. Collected at {auction.warehouse.name}, {auction.warehouse.address}, {auction.warehouse.state}
          {auction.warehouse.hours ? ` (${auction.warehouse.hours})` : ""}.
        </p>
      ) : null}
      {auction.status === "live" && !viewer?.seller ? (
        !signedIn ? (
          <Link href={signIn} className="grid min-h-11 place-items-center rounded-xl bg-navy-900 px-4 font-semibold text-white">
            Sign in to bid
          </Link>
        ) : !phoneConfirmed ? (
          <Link href="/account/profile#phone" className="grid min-h-11 place-items-center rounded-xl border border-navy-300 px-4 text-center text-sm font-semibold text-navy-900">
            Confirm your mobile number to bid
          </Link>
        ) : (
          <form onSubmit={bid} className="grid gap-2">
            <label htmlFor="listing-bid" className="text-sm font-semibold text-navy-900">
              Your bid ({currency})
            </label>
            <input id="listing-bid" inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} className="min-h-11 rounded-xl border border-navy-200 px-3" aria-describedby="listing-bid-least" />
            {auction.next_bid !== null ? (
              <p id="listing-bid-least" className="text-xs text-navy-600">
                At least {shopMoney(auction.next_bid, currency)}.
              </p>
            ) : null}
            <button type="submit" disabled={busy} className="min-h-11 rounded-xl bg-navy-900 px-4 font-semibold text-white disabled:opacity-60">
              Place bid
            </button>
          </form>
        )
      ) : null}
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
      <p className="text-xs text-navy-600">
        Each bid is at least {auction.rules.step_pct}% above the last, and at least {shopMoney(auction.rules.step_min, currency)} more; a bid in the last {auction.rules.extend_minutes} minutes moves the end to{" "}
        {auction.rules.extend_minutes} minutes after it.{" "}
        <Link href="/legal/auctions" className="font-semibold underline">
          Auction terms
        </Link>
      </p>
      {auction.recent_bids.length ? (
        <details className="text-sm">
          <summary className="cursor-pointer font-semibold text-navy-900">Bids</summary>
          <ul className="mt-1 grid gap-1">
            {auction.recent_bids.map(entry => (
              <li key={`${entry.at}-${entry.amount}`} className="flex justify-between gap-2">
                <span>{entry.name}</span>
                <span className="font-semibold">{shopMoney(entry.amount, currency)}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {dialog}
    </section>
  );
}
