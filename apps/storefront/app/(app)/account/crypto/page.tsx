import type { Metadata } from "next";
import Link from "next/link";
import { Lock, Snowflake } from "lucide-react";
import { formatCrypto, formatFace, type StoreCryptoWallets, type StoreList, type StoreP2pProfile, type StoreP2pTrade } from "@bitocard/api-client/storefront";
import { card, CoinBadge, CryptoGate, CryptoNav, TradeRow } from "@/components/app/crypto";
import { NicknameForm, QuickTrade, TestCryptoForm } from "@/components/app/crypto-forms";
import { customerApi } from "@/lib/customer";

export const metadata: Metadata = { title: "Crypto" };

/**
 * Crypto: the customer's coins (available, locked in their ads, frozen), their P2P money, a one-tap buy or sell at
 * the best price on the market, and their latest trades. Sandbox stores can add test crypto.
 */
export default async function CryptoPage() {
  const [overview, profile, trades] = await Promise.all([
    customerApi<StoreCryptoWallets>("GET", "/v1/store/crypto"),
    customerApi<StoreP2pProfile>("GET", "/v1/store/p2p/profile"),
    customerApi<StoreList<StoreP2pTrade>>("GET", "/v1/store/p2p/trades?limit=5"),
  ]);
  const wallets = overview.ok ? overview.data : null;
  const assets = wallets?.assets.map(item => item.asset) ?? [];
  const blocked = !wallets || !wallets.p2p_enabled || wallets.frozen || !wallets.verified;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="font-display text-2xl font-extrabold text-[#070f4c]">Crypto{wallets?.mode === "test" ? " (test)" : ""}</h1>
        <p className="text-sm text-slate-600">Buy and sell with other people, paid instantly from your BitoCard wallet.</p>
      </div>
      <CryptoNav current="/account/crypto" />
      {blocked ? <CryptoGate wallets={wallets} p2p /> : null}

      {wallets && !blocked ? (
        <section aria-labelledby="quick" className="rounded-3xl bg-[#070f4c] p-4 text-white sm:p-6">
          <h2 id="quick" className="mb-3 font-display text-lg font-bold">
            Quick buy or sell
          </h2>
          <div className="rounded-2xl bg-white p-4 text-[#070f4c]">
            <QuickTrade assets={assets} currency={wallets.currency} />
          </div>
        </section>
      ) : null}

      {wallets?.enabled ? (
        <section aria-labelledby="coins" className={card}>
          <h2 id="coins" className="mb-1 text-lg font-bold">
            Your coins
          </h2>
          <ul className="divide-y divide-slate-100">
            {wallets.assets.map(asset => (
              <li key={asset.asset} className="flex items-center gap-3 py-3">
                <CoinBadge asset={asset.asset} />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{asset.name}</span>
                  <span className="flex flex-wrap gap-x-3 text-xs text-slate-500">
                    {Number(asset.locked) > 0 ? (
                      <span className="inline-flex items-center gap-1">
                        <Lock className="size-3" aria-hidden="true" /> {formatCrypto(asset.locked)} in your ads
                      </span>
                    ) : null}
                    {Number(asset.frozen) > 0 ? (
                      <span className="inline-flex items-center gap-1 text-red-700">
                        <Snowflake className="size-3" aria-hidden="true" /> {formatCrypto(asset.frozen)} frozen
                      </span>
                    ) : null}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block font-bold">{formatCrypto(asset.available, asset.asset)}</span>
                  <span className="block text-xs text-slate-500">available</span>
                </span>
              </li>
            ))}
          </ul>
          <dl className="mt-3 grid gap-2 rounded-2xl bg-slate-50 p-3 text-sm sm:grid-cols-3">
            <div className="flex min-w-0 items-baseline justify-between gap-3 sm:block">
              <dt className="text-xs text-slate-500">P2P money</dt>
              <dd className="font-bold break-words">{formatFace(wallets.cash.proceeds, wallets.cash.currency)}</dd>
            </div>
            <div className="flex min-w-0 items-baseline justify-between gap-3 sm:block">
              <dt className="text-xs text-slate-500">Wallet</dt>
              <dd className="font-bold break-words">
                <Link href="/account/wallet" className="hover:underline">
                  {formatFace(wallets.cash.wallet, wallets.cash.currency)}
                </Link>
              </dd>
            </div>
            <div className="flex min-w-0 items-baseline justify-between gap-3 sm:block">
              <dt className="text-xs text-slate-500">In buy ads</dt>
              <dd className="font-bold break-words">{formatFace(wallets.cash.locked, wallets.cash.currency)}</dd>
            </div>
          </dl>
          <p className="mt-2 text-xs text-slate-500">Buying spends your P2P money first, then your wallet. Bank withdrawals of P2P money and on-chain deposits open soon.</p>
        </section>
      ) : null}

      {wallets?.mode === "test" && !blocked ? (
        <section aria-labelledby="test" className={card}>
          <h2 id="test" className="mb-3 text-lg font-bold">
            Test crypto
          </h2>
          <TestCryptoForm assets={assets} />
        </section>
      ) : null}

      {!blocked && trades.ok ? (
        <section aria-labelledby="recent" className={card}>
          <div className="mb-1 flex items-center justify-between">
            <h2 id="recent" className="text-lg font-bold">
              Latest trades
            </h2>
            <Link href="/account/crypto/trades" className="text-sm font-semibold text-[#ff2382] hover:underline">
              See all
            </Link>
          </div>
          {trades.data.data.length ? (
            <div className="divide-y divide-slate-100">
              {trades.data.data.map(trade => (
                <TradeRow key={trade.id} trade={trade} />
              ))}
            </div>
          ) : (
            <p className="text-slate-600">Your trades show here.</p>
          )}
        </section>
      ) : null}

      {!blocked && profile.ok && !profile.data.nickname_chosen ? (
        <section aria-labelledby="nickname" className={card}>
          <h2 id="nickname" className="mb-3 text-lg font-bold">
            Your market name
          </h2>
          <NicknameForm current={profile.data.nickname} />
        </section>
      ) : null}
    </div>
  );
}
