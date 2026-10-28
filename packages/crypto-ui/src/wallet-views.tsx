import type { ReactNode } from "react";
import Link from "next/link";
import { Check, ShieldAlert, ShieldCheck } from "lucide-react";
import { formatCrypto, type StoreCryptoWallets } from "@bitocard/api-client/storefront";
import { CoinBadge } from "./coins";
import { cardClass } from "./trade-views";
import { heldAssets } from "./wallets";

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

/**
 * Why the customer cannot use this part of crypto yet, or null when they can. `withdraw`: sending coins out, which
 * needs no crypto switch while they hold some. `declaration`: what to show when trading still needs their declaration
 * (the app's `CryptoDeclaration` with its action), for trading pages only.
 */
export function CryptoGate({ wallets, p2p = false, withdraw = false, verifyHref, declaration }: { wallets: StoreCryptoWallets | null; p2p?: boolean; withdraw?: boolean; verifyHref: string; declaration?: ReactNode }) {
  if (!wallets) return <p className={cardClass}>Crypto cannot be shown right now. Try again shortly.</p>;
  const closed = withdraw ? !wallets.enabled && heldAssets(wallets).length === 0 : !wallets.enabled || (p2p && !wallets.p2p_enabled);
  if (closed) {
    return (
      <div className={cardClass}>
        <p className="font-semibold">Crypto is not available in your country yet</p>
        <p className="mt-1 text-sm text-slate-600">
          {heldAssets(wallets).length
            ? "Trading is closed here for now. You can still withdraw the coins you hold."
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
  if (!wallets.verified) return <VerifyFirst href={verifyHref} title="Verify your identity to use crypto" text="Crypto needs a quick identity check, once. It keeps the market safe for everyone." />;
  if (p2p && wallets.declaration && !wallets.declaration.declared) return declaration ?? null;
  return null;
}

/** The identity check, asked for once (a plain link: it may be on the customer's account app, on another site). */
export function VerifyFirst({ href, title, text }: { href: string; title: string; text: string }) {
  return (
    <div className={cardClass}>
      <p className="flex items-center gap-2 font-semibold">
        <ShieldCheck className="size-5 text-brand-500" aria-hidden="true" /> {title}
      </p>
      <p className="mt-1 text-sm text-slate-600">{text}</p>
      <a href={href} className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-brand-500 px-4 font-semibold text-white hover:bg-brand-600">
        Verify my identity
      </a>
    </div>
  );
}
