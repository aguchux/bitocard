import type { ReactNode } from "react";
import { ShieldCheck } from "lucide-react";
import { formatCrypto, formatFace, type StoreP2pAd } from "@bitocard/api-client/storefront";
import { CoinBadge } from "./coins";

/** A card on the crypto pages. */
export const cardClass = "rounded-3xl bg-white p-5 ring-1 ring-slate-200/70";

/**
 * The declaration every account makes before trading: not a citizen or resident of the United States or the United
 * Kingdom. `action` is the app's server action recording it (`POST /v1/afrippa/crypto/declaration { version }`).
 */
export function CryptoDeclaration({ version, action }: { version: string; action: (form: FormData) => Promise<void> }) {
  return (
    <form action={action} className={cardClass}>
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

export const tradeDate = (iso: string) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

const adStatus: Record<StoreP2pAd["status"], [string, string]> = {
  active: ["On the market", "bg-emerald-50 text-emerald-800"],
  paused: ["Paused", "bg-amber-50 text-amber-800"],
  completed: ["Completed", "bg-slate-100 text-slate-700"],
  cancelled: ["Closed", "bg-slate-100 text-slate-700"],
};

/** One of the customer's own ads: what it sells or buys, how much is filled, its status; `controls` while it is open. */
export function MyAdCard({ ad, controls }: { ad: StoreP2pAd; controls?: ReactNode }) {
  const [label, tone] = adStatus[ad.status];
  return (
    <li className={cardClass}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <CoinBadge asset={ad.asset} />
          <div className="min-w-0">
            <p className="font-semibold">
              {ad.side === "sell" ? "Selling" : "Buying"} {formatCrypto(ad.total, ad.asset)}
            </p>
            <p className="text-sm text-slate-500">
              {formatFace(ad.price, ad.currency)} per {ad.asset} · {formatFace(ad.min_fiat, ad.currency)} – {formatFace(ad.max_fiat, ad.currency)}
            </p>
          </div>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${tone}`}>{label}</span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
        <div className="h-full rounded-full bg-brand-500" style={{ width: `${Math.min(100, (Number(ad.filled) / Number(ad.total)) * 100)}%` }} />
      </div>
      <p className="mt-1 text-xs text-slate-500">
        {formatCrypto(ad.filled, ad.asset)} filled · {formatCrypto(ad.available, ad.asset)} left
      </p>
      {controls && (ad.status === "active" || ad.status === "paused") ? <div className="mt-4 flex flex-wrap items-end gap-2">{controls}</div> : null}
    </li>
  );
}
