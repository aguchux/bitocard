import type { Metadata } from "next";
import { formatCrypto, formatFace, type StoreCryptoWallets, type StoreList, type StoreP2pAd } from "@bitocard/api-client/storefront";
import { card, CoinBadge, CryptoGate, CryptoNav, tradableAssets } from "@/components/app/crypto";
import { ActionButton, PostAdForm, RepriceForm } from "@/components/app/crypto-forms";
import { changeAd } from "@/lib/crypto-actions";
import { customerApi } from "@/lib/customer";

export const metadata: Metadata = { title: "My ads" };

const statusLabel: Record<StoreP2pAd["status"], string> = { active: "On the market", paused: "Paused", completed: "Completed", cancelled: "Closed" };
const statusTone: Record<StoreP2pAd["status"], string> = { active: "bg-emerald-50 text-emerald-800", paused: "bg-amber-50 text-amber-800", completed: "bg-slate-100 text-slate-700", cancelled: "bg-slate-100 text-slate-700" };

function AdButton({ id, op, children, danger = false }: { id: string; op: "pause" | "resume" | "cancel"; children: string; danger?: boolean }) {
  return (
    <ActionButton action={changeAd} fields={{ id, op }} className={`min-h-12 rounded-xl px-4 text-sm font-semibold ring-1 ${danger ? "text-red-700 ring-red-200 hover:ring-red-300" : "ring-slate-300 hover:ring-slate-400"}`}>
      {children}
    </ActionButton>
  );
}

/** The customer's ads: post a new one, see what each has filled, change its price, pause or close it. */
export default async function AdsPage({ searchParams }: { searchParams: Promise<{ posted?: string }> }) {
  const params = await searchParams;
  const [overview, open, closed] = await Promise.all([
    customerApi<StoreCryptoWallets>("GET", "/v1/store/crypto"),
    customerApi<StoreList<StoreP2pAd>>("GET", "/v1/store/p2p/ads"),
    customerApi<StoreList<StoreP2pAd>>("GET", "/v1/store/p2p/ads?status=closed"),
  ]);
  const wallets = overview.ok ? overview.data : null;
  const blocked = !wallets || !wallets.p2p_enabled || wallets.frozen || !wallets.verified;
  const ads = [...(open.ok ? open.data.data : []), ...(closed.ok ? closed.data.data.slice(0, 10) : [])];

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <h1 className="font-display text-2xl font-extrabold text-navy-900">My ads</h1>
      <CryptoNav current="/account/crypto/ads" />
      {params.posted ? (
        <p className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800" role="status">
          Your ad is on the market. Trades against it settle at once and show in Trades.
        </p>
      ) : null}
      {blocked ? <CryptoGate wallets={wallets} p2p /> : null}
      {wallets && !blocked ? (
        <section aria-labelledby="post" className={card}>
          <h2 id="post" className="mb-3 text-lg font-bold">
            Post an ad
          </h2>
          <PostAdForm assets={tradableAssets(wallets)} currency={wallets.currency} />
        </section>
      ) : null}
      {ads.length ? (
        <ul className="space-y-3" aria-label="Your ads">
          {ads.map(ad => {
            const open = ad.status === "active" || ad.status === "paused";
            return (
              <li key={ad.id} className={card}>
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
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusTone[ad.status]}`}>{statusLabel[ad.status]}</span>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
                  <div className="h-full rounded-full bg-brand-500" style={{ width: `${Math.min(100, (Number(ad.filled) / Number(ad.total)) * 100)}%` }} />
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {formatCrypto(ad.filled, ad.asset)} filled · {formatCrypto(ad.available, ad.asset)} left
                </p>
                {open ? (
                  <div className="mt-4 flex flex-wrap items-end gap-2">
                    <RepriceForm id={ad.id} currency={ad.currency} price={String(ad.price / 100)} />
                    <AdButton id={ad.id} op={ad.status === "active" ? "pause" : "resume"}>
                      {ad.status === "active" ? "Pause" : "Resume"}
                    </AdButton>
                    <AdButton id={ad.id} op="cancel" danger>
                      Close ad
                    </AdButton>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : !blocked ? (
        <p className={card}>You have no ads yet. Post one above: sell ads lock your coins until traded or closed; buy ads lock the money they need.</p>
      ) : null}
    </div>
  );
}
