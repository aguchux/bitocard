import Link from "next/link";
import { Check, ShieldAlert, ShieldCheck } from "lucide-react";
import { formatCrypto, formatFace, type StoreCryptoWallets, type StoreCryptoWithdrawal, type StoreP2pTrade } from "@bitocard/api-client/storefront";
import { cryptoSections } from "./sub-menus";
import { UnderlineTabs } from "@bitocard/ui/underline-tabs";
import { declareCrypto } from "@/lib/crypto-actions";

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

/**
 * The crypto section's places (`cryptoSections`), as underlined tabs under the page title on phones and tablets (they
 * slide sideways inside their own row, never the page); desktops have the sub rail beside the app's rail instead
 * (`SubRail`).
 */
export function CryptoNav({ current }: { current: string }) {
  return <UnderlineTabs label="Crypto" tabs={cryptoSections.map(({ href, label }) => ({ href, label }))} current={current} className="lg:hidden" />;
}

/**
 * Each coin's colour and mark (its currency sign where it has one, else its first letter), drawn here: no outside
 * images. The mark stays legible at every badge size, where a 4-letter code never fitted.
 */
const coinMarks: Record<string, { colour: string; glyph: string }> = {
  USDT: { colour: "bg-emerald-500 text-white", glyph: "₮" },
  USDC: { colour: "bg-blue-600 text-white", glyph: "$" },
  BTC: { colour: "bg-orange-500 text-white", glyph: "₿" },
  ETH: { colour: "bg-indigo-600 text-white", glyph: "Ξ" },
  BNB: { colour: "bg-yellow-400 text-navy-900", glyph: "B" },
  POL: { colour: "bg-violet-600 text-white", glyph: "P" },
  TRX: { colour: "bg-red-600 text-white", glyph: "T" },
  LTC: { colour: "bg-slate-600 text-white", glyph: "Ł" },
  DOGE: { colour: "bg-amber-500 text-navy-900", glyph: "Ð" },
};
export const coinMark = (asset: string) => coinMarks[asset] ?? { colour: "bg-slate-500 text-white", glyph: asset.slice(0, 1) };

/** The mark's size for each badge size used. */
const glyphSizes: Record<string, string> = { "size-8": "text-sm", "size-9": "text-base", "size-10": "text-lg", "size-12": "text-xl" };

/** A coin's round badge: its mark on its colour, with a soft inner shade. */
export function CoinBadge({ asset, size = "size-10" }: { asset: string; size?: string }) {
  const mark = coinMark(asset);
  return (
    <span
      className={`grid ${size} shrink-0 place-items-center rounded-full font-extrabold leading-none shadow-[inset_0_-2px_0_rgb(0_0_0/0.14)] ring-1 ring-black/5 ${glyphSizes[size] ?? "text-lg"} ${mark.colour}`}
      aria-hidden="true"
    >
      {mark.glyph}
    </span>
  );
}

/**
 * Choosing a coin: every coin as a tile (its badge, code, and its name or the balance), all in view at once, never
 * hidden off the side of a scrolling row. Three to a row on phones (stacked tiles), as many as fit from tablets up.
 * The chosen one is filled navy with a pink tick. `show: "available"` puts each coin's available balance under its code
 * (withdrawing); otherwise its name.
 */
export function CoinPicker({
  assets,
  wallets,
  current,
  href,
  label = "Coin",
  show = "name",
}: {
  assets: string[];
  wallets: StoreCryptoWallets | null;
  current: string;
  href: (asset: string) => string;
  label?: string;
  show?: "name" | "available";
}) {
  const balances = new Map(wallets?.assets.map(item => [item.asset, item]) ?? []);
  return (
    <nav aria-labelledby="coin-picker" className="space-y-2">
      <h2 id="coin-picker" className="text-xs font-bold tracking-wider text-slate-500 uppercase">
        {label}
      </h2>
      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-[repeat(auto-fill,minmax(8.75rem,1fr))]">
        {assets.map(code => {
          const balance = balances.get(code);
          const chosen = code === current;
          const note = show === "available" ? (balance ? formatCrypto(balance.available) : "0") : (balance?.name ?? code);
          return (
            <li key={code} className="min-w-0">
              <Link
                href={href(code)}
                aria-current={chosen ? "page" : undefined}
                title={balance?.name ?? code}
                className={`group relative flex min-h-16 min-w-0 flex-col items-center justify-center gap-1.5 rounded-2xl px-2 py-2.5 text-center transition focus-visible:outline-3 focus-visible:outline-offset-5 focus-visible:outline-brand-700 sm:flex-row sm:justify-start sm:gap-2.5 sm:px-3 sm:text-left ${
                  chosen ? "bg-brand-50 text-brand-700 shadow-sm ring-2 ring-brand-500" : "bg-white text-navy-900 ring-1 ring-slate-200 hover:-translate-y-px hover:shadow-sm hover:ring-slate-300"
                }`}
              >
                <CoinBadge asset={code} size="size-9" />
                <span className="min-w-0 leading-tight sm:flex-1">
                  <span className="block text-sm font-bold">{code}</span>
                  <span className={`block truncate text-[11px] sm:text-xs ${chosen ? "text-brand-700" : "text-slate-500"}`}>{note}</span>
                </span>
                {chosen ? (
                  <span className="absolute -top-1.5 -right-1.5 grid size-5 place-items-center rounded-full bg-brand-500 text-white ring-2 ring-white">
                    <Check className="size-3" strokeWidth={3} aria-hidden="true" />
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
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
export const hasP2pMoney = (wallets: StoreCryptoWallets | null) => Boolean(wallets && (wallets.cash.proceeds > 0 || wallets.cash.paying_out > 0 || (wallets.usd_cash?.proceeds ?? 0) > 0));

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
            ? "Trading is closed here for now. You can still withdraw the coins you hold and cash out eligible local-currency P2P money."
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
  if (p2p && wallets.declaration && !wallets.declaration.declared) return <CryptoDeclaration version={wallets.declaration.version} />;
  return null;
}

/** The declaration every account makes before trading: not a citizen or resident of the United States or the United Kingdom. */
export function CryptoDeclaration({ version }: { version: string }) {
  return (
    <form action={declareCrypto} className={card}>
      <p className="flex items-center gap-2 font-semibold">
        <ShieldCheck className="size-5 text-brand-500" aria-hidden="true" /> One question before you trade
      </p>
      <p className="mt-1 text-sm text-slate-600">Crypto trading is open only to residents of the countries we serve.</p>
      <input type="hidden" name="version" value={version} />
      <label className="mt-4 flex items-start gap-3 text-sm font-medium text-navy-900">
        <input type="checkbox" name="confirm" value="yes" required className="mt-0.5 size-5 shrink-0 accent-brand-500" />
        I am not a citizen or a resident of the United States or the United Kingdom.
      </label>
      <button type="submit" className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-brand-500 px-4 font-semibold text-white hover:bg-brand-600">
        Confirm and continue
      </button>
    </form>
  );
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
