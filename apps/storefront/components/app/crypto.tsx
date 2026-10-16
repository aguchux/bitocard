import Link from "next/link";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import { formatCrypto, formatFace, type StoreCryptoWallets, type StoreCryptoWithdrawal, type StoreP2pTrade } from "@bitocard/api-client/storefront";

export const card = "rounded-3xl bg-white p-5 ring-1 ring-slate-200/70";

/** A withdrawal's status in plain words. */
export const withdrawalStatus: Record<StoreCryptoWithdrawal["status"], string> = {
  awaiting_code: "Waiting for your code",
  review: "Being checked",
  queued: "Sending",
  submitting: "Sending",
  broadcast: "On the network",
  completed: "Sent",
  failed: "Not sent",
  rejected: "Not approved",
  cancelled: "Cancelled",
};

const sections = [
  { href: "/account/crypto", label: "Wallets" },
  { href: "/account/crypto/market", label: "Market" },
  { href: "/account/crypto/ads", label: "My ads" },
  { href: "/account/crypto/trades", label: "Trades" },
  { href: "/account/crypto/deposit", label: "Deposit" },
  { href: "/account/crypto/withdraw", label: "Withdraw" },
  { href: "/account/crypto/cash-out", label: "Cash out" },
];

/**
 * The crypto section's places, as pills under the page title. On phones the row scrolls sideways on its own, inside
 * its own box, so the page never scrolls sideways.
 */
export function CryptoNav({ current }: { current: string }) {
  return (
    <nav aria-label="Crypto" className="-mx-1 flex min-w-0 gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
      {sections.map(section => (
        <Link
          key={section.href}
          href={section.href}
          aria-current={section.href === current ? "page" : undefined}
          className="inline-flex min-h-10 shrink-0 items-center rounded-full px-4 text-sm font-semibold text-slate-600 ring-1 ring-slate-200 aria-[current=page]:bg-navy-900 aria-[current=page]:text-white aria-[current=page]:ring-navy-900"
        >
          {section.label}
        </Link>
      ))}
    </nav>
  );
}

/** A coin's round badge: its code's first letters on its colour (no outside images). */
const coinColours: Record<string, string> = { USDT: "bg-emerald-500", USDC: "bg-blue-600", BTC: "bg-orange-500", ETH: "bg-indigo-600", BNB: "bg-yellow-400 text-navy-900" };
export function CoinBadge({ asset, size = "size-10" }: { asset: string; size?: string }) {
  return (
    <span className={`grid ${size} shrink-0 place-items-center rounded-full text-[11px] font-extrabold text-white ${coinColours[asset] ?? "bg-slate-500"}`} aria-hidden="true">
      {asset.slice(0, asset === "USDT" || asset === "USDC" ? 4 : 3)}
    </span>
  );
}

/** Coins the customer can deposit and trade now: crypto is open to them and the coin is not switched off. */
export const tradableAssets = (wallets: StoreCryptoWallets | null) => (wallets?.enabled ? wallets.assets.filter(item => item.enabled).map(item => item.asset) : []);

/** Coins the customer holds (anything available, locked, frozen or on its way out). */
export const heldAssets = (wallets: StoreCryptoWallets | null) => wallets?.assets.filter(item => Number(item.total) > 0) ?? [];

/**
 * Coins the customer can withdraw: what they hold, plus every tradable coin while crypto is open. Withdrawing needs no
 * crypto switch (switching crypto off never traps anyone's coins), only a verified, unfrozen account.
 */
export const withdrawableAssets = (wallets: StoreCryptoWallets | null) => {
  const tradable = new Set(tradableAssets(wallets));
  return wallets?.assets.filter(item => tradable.has(item.asset) || Number(item.total) > 0).map(item => item.asset) ?? [];
};

/** Whether the Withdraw button belongs on screen: verified, not frozen, and with available coins. */
export const canWithdraw = (wallets: StoreCryptoWallets | null) => Boolean(wallets && wallets.verified && !wallets.frozen && wallets.assets.some(item => Number(item.available) > 0));

/** P2P money left from selling: still to pay out, or on its way to the bank. Shown even with crypto switched off. */
export const hasP2pMoney = (wallets: StoreCryptoWallets | null) => Boolean(wallets && (wallets.cash.proceeds > 0 || wallets.cash.paying_out > 0));

/**
 * Why the customer cannot use this part of crypto yet, or null when they can. `withdraw`: sending coins out, which
 * needs no crypto switch while they hold some.
 */
export function CryptoGate({ wallets, p2p = false, withdraw = false }: { wallets: StoreCryptoWallets | null; p2p?: boolean; withdraw?: boolean }) {
  if (!wallets) return <p className={card}>Crypto cannot be shown right now. Try again shortly.</p>;
  const closed = withdraw ? !wallets.enabled && heldAssets(wallets).length === 0 : !wallets.enabled || (p2p && !wallets.p2p_enabled);
  if (closed) {
    return (
      <div className={card}>
        <p className="font-semibold">Crypto is not available in your country yet</p>
        <p className="mt-1 text-sm text-slate-600">
          {heldAssets(wallets).length || hasP2pMoney(wallets)
            ? "Trading is closed here for now. You can still withdraw the coins you hold and cash out your P2P money."
            : "We open it country by country. We will tell you when you can hold and trade crypto here."}
        </p>
      </div>
    );
  }
  if (wallets.frozen) {
    return (
      <div className="flex gap-3 rounded-3xl bg-red-50 p-5 text-red-900 ring-1 ring-red-200" role="alert">
        <ShieldAlert className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
        <div>
          <p className="font-semibold">Your crypto account is frozen</p>
          <p className="mt-1 text-sm">You cannot trade or withdraw until BitoCard has looked into your account. Contact support to find out more.</p>
        </div>
      </div>
    );
  }
  if (!wallets.verified) {
    return (
      <div className={card}>
        <p className="flex items-center gap-2 font-semibold">
          <ShieldCheck className="size-5 text-brand-500" aria-hidden="true" /> Verify your identity to use crypto
        </p>
        <p className="mt-1 text-sm text-slate-600">Crypto needs a quick identity check, once. It keeps the market safe for everyone.</p>
        <Link href="/account/verification" className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-brand-500 px-4 font-semibold text-white hover:bg-brand-600">
          Verify my identity
        </Link>
      </div>
    );
  }
  return null;
}

export const perCoin = (price: number, currency: string, asset: string) => `${formatFace(price, currency)} / ${asset}`;
export const date = (iso: string) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

/** A trade as a list row: what moved, with whom, and when. */
export function TradeRow({ trade }: { trade: StoreP2pTrade }) {
  const bought = trade.side === "buy";
  return (
    <Link href={`/account/crypto/trades/${trade.id}`} className="flex items-center gap-3 py-3 hover:bg-slate-50">
      <CoinBadge asset={trade.asset} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">
          {bought ? "Bought" : "Sold"} {formatCrypto(bought ? trade.received : trade.amount, trade.asset)}
        </span>
        <span className="block truncate text-sm text-slate-500">
          {trade.number} · {bought ? "from" : "to"} {trade.counterparty.nickname} · {date(trade.created_at)}
        </span>
      </span>
      <span className={`shrink-0 font-semibold ${bought ? "text-navy-900" : "text-emerald-700"}`}>
        {bought ? "−" : "+"}
        {formatFace(trade.fiat, trade.currency)}
      </span>
    </Link>
  );
}
