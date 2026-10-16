import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, Lock, Snowflake } from "lucide-react";
import { formatCrypto, formatFace, type StoreCryptoWallets, type StoreList, type StoreP2pProfile, type StoreP2pTrade } from "@bitocard/api-client/storefront";
import { canWithdraw, card, CoinBadge, CryptoGate, CryptoNav, hasP2pMoney, heldAssets, TradeRow, tradableAssets } from "@/components/app/crypto";
import { NicknameForm, QuickTrade, TestCryptoForm } from "@/components/app/crypto-forms";
import { customerApi } from "@/lib/customer";

export const metadata: Metadata = { title: "Crypto" };

/**
 * Crypto: the customer's coins (available, locked in their ads, frozen, on their way out), their P2P money, a one-tap
 * buy or sell at the best price on the market, and their latest trades. Sandbox stores can add test crypto. With crypto
 * closed to them, what they still hold stays here to withdraw and cash out.
 */
export default async function CryptoPage() {
  const [overview, profile, trades] = await Promise.all([
    customerApi<StoreCryptoWallets>("GET", "/v1/store/crypto"),
    customerApi<StoreP2pProfile>("GET", "/v1/store/p2p/profile"),
    customerApi<StoreList<StoreP2pTrade>>("GET", "/v1/store/p2p/trades?limit=5"),
  ]);
  const wallets = overview.ok ? overview.data : null;
  // Coins that can be traded or deposited: crypto open to them and the coin not switched off.
  const assets = tradableAssets(wallets);
  const blocked = !wallets || !wallets.p2p_enabled || wallets.frozen || !wallets.verified;
  // Shown while crypto is open, or while they still hold coins or P2P money (switching crypto off never traps them).
  const coins = wallets ? (wallets.enabled ? wallets.assets : heldAssets(wallets)) : [];
  const showHoldings = Boolean(wallets && (wallets.enabled || coins.length > 0 || hasP2pMoney(wallets)));

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="font-display text-2xl font-extrabold text-navy-900">Crypto{wallets?.mode === "test" ? " (test)" : ""}</h1>
        <p className="text-sm text-slate-600">Buy and sell with other people, paid instantly from your BitoCard wallet.</p>
      </div>
      <CryptoNav current="/account/crypto" />
      {blocked ? <CryptoGate wallets={wallets} p2p /> : null}

      {wallets && !blocked ? (
        <section aria-labelledby="quick" className="rounded-3xl bg-navy-900 p-4 text-white sm:p-6">
          <h2 id="quick" className="mb-3 font-display text-lg font-bold">
            Quick buy or sell
          </h2>
          <div className="rounded-2xl bg-white p-4 text-navy-900">
            <QuickTrade assets={assets} currency={wallets.currency} />
          </div>
        </section>
      ) : null}

      {wallets && showHoldings ? (
        <section aria-labelledby="coins" className={card}>
          <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
            <h2 id="coins" className="text-lg font-bold">
              Your coins
            </h2>
            <span className="flex gap-2">
              {wallets.enabled && !wallets.frozen && wallets.verified ? (
                <Link href="/account/crypto/deposit" className="inline-flex min-h-10 items-center rounded-xl bg-navy-900 px-4 text-sm font-semibold text-white">
                  Deposit
                </Link>
              ) : null}
              {canWithdraw(wallets) ? (
                <Link href="/account/crypto/withdraw" className="inline-flex min-h-10 items-center rounded-xl px-4 text-sm font-semibold text-navy-900 ring-1 ring-slate-300">
                  Withdraw
                </Link>
              ) : null}
            </span>
          </div>
          {!coins.length ? <p className="py-3 text-sm text-slate-600">You hold no coins.</p> : null}
          <ul className="divide-y divide-slate-100">
            {coins.map(asset => (
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
                    {Number(asset.withdrawing) > 0 ? (
                      <span className="inline-flex items-center gap-1">
                        <ArrowUpRight className="size-3" aria-hidden="true" /> {formatCrypto(asset.withdrawing)} on its way out
                      </span>
                    ) : null}
                    {!asset.enabled ? <span>No longer traded here: you can withdraw it</span> : null}
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
              <dd className="font-bold break-words">
                <Link href="/account/crypto/cash-out" className="hover:underline">
                  {formatFace(wallets.cash.proceeds, wallets.cash.currency)} · Cash out
                </Link>
                {wallets.cash.paying_out > 0 ? (
                  <span className="block text-xs font-normal text-slate-500">{formatFace(wallets.cash.paying_out, wallets.cash.currency)} on its way to your bank</span>
                ) : null}
              </dd>
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
          <p className="mt-2 text-xs text-slate-500">Buying spends your P2P money first, then your wallet. Cash out pays your P2P money into your own bank account.</p>
        </section>
      ) : null}

      {wallets?.mode === "test" && wallets.enabled && !wallets.frozen && assets.length ? (
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
            <Link href="/account/crypto/trades" className="text-sm font-semibold text-brand-500 hover:underline">
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
