import Link from "next/link";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import { formatCrypto, formatFace, type StoreCryptoWallets, type StoreP2pTrade } from "@bitocard/api-client/storefront";

export const card = "rounded-3xl bg-white p-5 ring-1 ring-slate-200/70";

const sections = [
  { href: "/account/crypto", label: "Wallets" },
  { href: "/account/crypto/market", label: "Market" },
  { href: "/account/crypto/ads", label: "My ads" },
  { href: "/account/crypto/trades", label: "Trades" },
];

/** The crypto section's places, as pills under the page title (scrolls sideways on its own on small phones). */
export function CryptoNav({ current }: { current: string }) {
  return (
    <nav aria-label="Crypto" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
      {sections.map(section => (
        <Link
          key={section.href}
          href={section.href}
          aria-current={section.href === current ? "page" : undefined}
          className="inline-flex min-h-10 shrink-0 items-center rounded-full px-4 text-sm font-semibold text-slate-600 ring-1 ring-slate-200 aria-[current=page]:bg-[#070f4c] aria-[current=page]:text-white aria-[current=page]:ring-[#070f4c]"
        >
          {section.label}
        </Link>
      ))}
    </nav>
  );
}

/** A coin's round badge: its code's first letters on its colour (no outside images). */
const coinColours: Record<string, string> = { USDT: "bg-emerald-500", USDC: "bg-blue-600", BTC: "bg-orange-500", ETH: "bg-indigo-600", BNB: "bg-yellow-400 text-[#070f4c]" };
export function CoinBadge({ asset, size = "size-10" }: { asset: string; size?: string }) {
  return (
    <span className={`grid ${size} shrink-0 place-items-center rounded-full text-[11px] font-extrabold text-white ${coinColours[asset] ?? "bg-slate-500"}`} aria-hidden="true">
      {asset.slice(0, asset === "USDT" || asset === "USDC" ? 4 : 3)}
    </span>
  );
}

/** Why the customer cannot trade yet, or null when they can. */
export function CryptoGate({ wallets, p2p = false }: { wallets: StoreCryptoWallets | null; p2p?: boolean }) {
  if (!wallets) return <p className={card}>Crypto cannot be shown right now. Try again shortly.</p>;
  if (!wallets.enabled || (p2p && !wallets.p2p_enabled)) {
    return (
      <div className={card}>
        <p className="font-semibold">Crypto is not available in your country yet</p>
        <p className="mt-1 text-sm text-slate-600">We open it country by country. We will tell you when you can hold and trade crypto here.</p>
      </div>
    );
  }
  if (wallets.frozen) {
    return (
      <div className="flex gap-3 rounded-3xl bg-red-50 p-5 text-red-900 ring-1 ring-red-200" role="alert">
        <ShieldAlert className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
        <div>
          <p className="font-semibold">Your crypto account is frozen</p>
          <p className="mt-1 text-sm">You cannot trade until BitoCard has looked into your account. Contact support to find out more.</p>
        </div>
      </div>
    );
  }
  if (!wallets.verified) {
    return (
      <div className={card}>
        <p className="flex items-center gap-2 font-semibold">
          <ShieldCheck className="size-5 text-[#ff2382]" aria-hidden="true" /> Verify your identity to use crypto
        </p>
        <p className="mt-1 text-sm text-slate-600">Crypto needs a quick identity check, once. It keeps the market safe for everyone.</p>
        <Link href="/account/verification" className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-[#ff2382] px-4 font-semibold text-white hover:bg-[#e8116d]">
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
      <span className={`shrink-0 font-semibold ${bought ? "text-[#070f4c]" : "text-emerald-700"}`}>
        {bought ? "−" : "+"}
        {formatFace(trade.fiat, trade.currency)}
      </span>
    </Link>
  );
}
