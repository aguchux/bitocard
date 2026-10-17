import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, ChevronLeft, Clock, Coins, Landmark, Lock, Snowflake, Wallet } from "lucide-react";
import { formatCrypto, formatFace, type StoreCryptoTransaction, type StoreCryptoWallets, type StoreExchange, type StoreList, type StoreWalletTopUp, type StoreWalletTransaction } from "@bitocard/api-client/storefront";
import { canWithdraw, CoinBadge, hasP2pMoney, heldAssets } from "@/components/app/crypto";
import { ActivityHeading, CryptoActivityList, MoneyActivityList } from "@/components/app/wallet-activity";
import { AddFunds, BankAccountDialog, BankAccountLink } from "@/components/app/wallet-forms";
import { activityHref, cryptoMoves, recentItems } from "@/lib/activity";
import { walletExchangeLinks } from "@/lib/exchange";
import { currentCustomer, customerApi, safeNext } from "@/lib/customer";
import { simulateTopUp, walletFor } from "@/lib/wallet";

export const metadata: Metadata = { title: "Wallet" };

const card = "rounded-3xl bg-white p-5 ring-1 ring-slate-200/70";

type Search = { top_up?: string; back?: string; amount?: string; wallet?: string };

/** "US dollars" or the country's currency code, as the wallet tabs name them. */
const walletLabel = (currency: string) => (currency === "USD" ? "US dollars" : currency);

/** A top-up just made (back from the payment page, or in the sandbox): where it stands. */
async function TopUpStatus({ id }: { id: string }) {
  const result = await customerApi<StoreWalletTopUp>("GET", `/v1/store/wallet/top-ups/${encodeURIComponent(id)}`);
  if (!result.ok) return null;
  const topUp = result.data;
  const money = formatFace(topUp.amount, topUp.currency);
  if (topUp.status === "succeeded") {
    return <p className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800" role="status">{money} has been added to your wallet.</p>;
  }
  if (topUp.status === "failed") {
    return <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">Your top-up of {money} did not go through. {topUp.failure_reason ?? ""}</p>;
  }
  return (
    <div className="space-y-3 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900" role="status">
      <p className="flex items-center gap-2 font-semibold">
        <Clock className="size-4" aria-hidden="true" /> Waiting for your payment of {money} to be confirmed.
      </p>
      {topUp.mode === "test" ? (
        <div className="flex flex-wrap gap-2">
          {(["succeeded", "failed"] as const).map(outcome => (
            <form key={outcome} action={simulateTopUp}>
              <input type="hidden" name="id" value={topUp.id} />
              <input type="hidden" name="outcome" value={outcome} />
              <button type="submit" className="min-h-10 rounded-xl bg-white px-3 font-semibold ring-1 ring-amber-200 hover:ring-amber-300">
                {outcome === "succeeded" ? "Simulate paid" : "Simulate failed"}
              </button>
            </form>
          ))}
        </div>
      ) : topUp.checkout_url ? (
        <a href={topUp.checkout_url} className="font-semibold underline">
          Back to the payment page
        </a>
      ) : null}
    </div>
  );
}

/**
 * The wallet: the balance with Add funds beside it (a popup: card, mobile money, Flutterwave, or the customer's own bank
 * account number), and what went in and out. Spent only in this store, never withdrawn. It is in the customer's own
 * country's currency, chosen at sign-up and fixed (Account shows it); an older account chooses it there first.
 */
/** "3 coins", or how many wallets there are while none holds anything (or "P2P money" with crypto closed): the Crypto tab's summary. */
const coinsSummary = (wallets: StoreCryptoWallets) => {
  const held = heldAssets(wallets).length;
  if (held) return `${held} coin${held === 1 ? "" : "s"}`;
  return wallets.enabled ? `${wallets.assets.length} wallets` : "P2P money";
};

/**
 * The Crypto tab: every coin wallet with its balance (available, in ads, frozen, on its way out), the P2P money, and
 * the last 24 hours of coin activity (a few, View all for the rest). With crypto closed to them, only what they still
 * hold, which they can still withdraw or cash out.
 */
function CryptoWallets({ wallets, activity, exchange }: { wallets: StoreCryptoWallets; activity: StoreCryptoTransaction[] | null; exchange: StoreExchange | null }) {
  const usable = wallets.enabled && !wallets.frozen && wallets.verified;
  const withdraw = canWithdraw(wallets);
  const coins = wallets.enabled ? wallets.assets : heldAssets(wallets);
  const moves = cryptoMoves(activity ?? []);
  const recent = recentItems(moves);
  return (
    <>
      <section aria-label="Crypto wallets" className="rounded-3xl bg-navy-900 p-6 text-white">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <p className="flex items-center gap-2 text-sm text-white/70">
            <Coins className="size-4" aria-hidden="true" /> Crypto wallets{wallets.mode === "test" ? " (test)" : ""}
          </p>
          {usable || withdraw ? (
            <span className="flex flex-wrap gap-2">
              {usable ? (
                <Link href="/account/crypto/deposit" className="inline-flex min-h-10 items-center rounded-xl bg-white/10 px-3 text-sm font-semibold hover:bg-white/20">
                  Deposit
                </Link>
              ) : null}
              {withdraw ? (
                <Link href="/account/crypto/withdraw" className="inline-flex min-h-10 items-center rounded-xl bg-white/10 px-3 text-sm font-semibold hover:bg-white/20">
                  Withdraw
                </Link>
              ) : null}
              {usable ? (
                <Link href="/account/crypto" className="inline-flex min-h-10 items-center rounded-xl bg-brand-500 px-3 text-sm font-semibold hover:bg-brand-600">
                  Buy or sell
                </Link>
              ) : null}
            </span>
          ) : null}
        </div>
        {!wallets.enabled ? <p className="mt-2 text-sm text-white/70">Crypto is closed in your country. You can still withdraw what you hold and cash out your P2P money.</p> : null}
        <ul className="mt-3 divide-y divide-white/10">
          {coins.map(asset => {
            // Buy and Sell straight from BitoCard's reserve, where the instant exchange is offered to them.
            const links = usable ? walletExchangeLinks(exchange, asset.asset, asset.available) : { buy: null, sell: null };
            return (
            <li key={asset.asset} className="py-3">
              <div className="flex items-center gap-3">
              <CoinBadge asset={asset.asset} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{asset.name}</span>
                <span className="flex flex-wrap gap-x-3 text-xs text-white/60">
                  <span>{asset.asset}</span>
                  {Number(asset.locked) > 0 ? (
                    <span className="inline-flex items-center gap-1">
                      <Lock className="size-3" aria-hidden="true" /> {formatCrypto(asset.locked)} in your ads
                    </span>
                  ) : null}
                  {Number(asset.frozen) > 0 ? (
                    <span className="inline-flex items-center gap-1 text-red-300">
                      <Snowflake className="size-3" aria-hidden="true" /> {formatCrypto(asset.frozen)} frozen
                    </span>
                  ) : null}
                  {Number(asset.withdrawing) > 0 ? (
                    <span className="inline-flex items-center gap-1">
                      <ArrowUpRight className="size-3" aria-hidden="true" /> {formatCrypto(asset.withdrawing)} on its way out
                    </span>
                  ) : null}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block font-bold">{formatCrypto(asset.total, asset.asset)}</span>
                {asset.total !== asset.available ? <span className="block text-xs text-white/60">{formatCrypto(asset.available)} available</span> : null}
              </span>
              </div>
              {links.buy || links.sell ? (
                <span className="mt-2 flex gap-2 pl-13">
                  {links.buy ? (
                    <Link href={links.buy} aria-label={`Buy ${asset.asset}`} className="inline-flex min-h-11 items-center rounded-xl bg-white/10 px-4 text-sm font-semibold hover:bg-white/20">
                      Buy
                    </Link>
                  ) : null}
                  {links.sell ? (
                    <Link href={links.sell} aria-label={`Sell ${asset.asset}`} className="inline-flex min-h-11 items-center rounded-xl bg-white/10 px-4 text-sm font-semibold hover:bg-white/20">
                      Sell
                    </Link>
                  ) : null}
                </span>
              ) : null}
            </li>
            );
          })}
        </ul>
        {wallets.enabled || hasP2pMoney(wallets) ? (
          <div className="mt-3 border-t border-white/10 pt-3 text-sm">
            <p className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <span className="text-white/70">P2P money (from your sales)</span>
              <Link href="/account/crypto/cash-out" className="font-bold hover:underline">
                {formatFace(wallets.cash.proceeds, wallets.cash.currency)} · Cash out
              </Link>
            </p>
            {wallets.cash.paying_out > 0 ? <p className="mt-1 text-xs text-white/60">{formatFace(wallets.cash.paying_out, wallets.cash.currency)} on its way to your bank</p> : null}
          </div>
        ) : null}
      </section>
      <section aria-labelledby="crypto-activity" className={card}>
        <ActivityHeading id="crypto-activity" note="Last 24 hours" viewAll={activityHref("crypto")} />
        {recent.length ? (
          <CryptoActivityList items={recent} />
        ) : (
          <p className="text-slate-600">{moves.length ? "Nothing in the last 24 hours. View all for older activity." : "Deposits and trades show here."}</p>
        )}
      </section>
    </>
  );
}

export default async function WalletPage({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams;
  // The country wallet unless `?wallet=USD` chose the US dollar one, or `?wallet=crypto` the coins.
  const showCrypto = params.wallet === "crypto";
  const asked = /^[A-Za-z]{3}$/.test(params.wallet ?? "") ? params.wallet!.toUpperCase() : undefined;
  const [customer, chosen, activity, overview, cryptoActivity, exchange] = await Promise.all([
    currentCustomer(),
    walletFor(asked),
    showCrypto ? null : customerApi<StoreList<StoreWalletTransaction>>("GET", "/v1/store/wallet/transactions?limit=20"),
    customerApi<StoreCryptoWallets>("GET", "/v1/store/crypto"),
    // Enough to find the last 24 hours' few once lock moves are left out.
    showCrypto ? customerApi<StoreList<StoreCryptoTransaction>>("GET", "/v1/store/crypto/transactions?limit=30") : null,
    // Whether the coins' rows get Buy and Sell from BitoCard's reserve.
    showCrypto ? customerApi<StoreExchange>("GET", "/v1/store/exchange") : null,
  ]);
  const wallet = chosen ?? (asked ? await walletFor() : null);
  // The Crypto tab is there where the store offers crypto, or while the customer still holds coins or P2P money.
  const crypto = overview.ok && (overview.data.enabled || heldAssets(overview.data).length > 0 || hasP2pMoney(overview.data)) ? overview.data : null;
  const cryptoTab = showCrypto && crypto !== null;
  const back = params.back ? safeNext(params.back, "") : "";
  const primary = wallet?.wallets.find(item => item.primary)?.currency ?? wallet?.currency;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="sr-only">Wallet</h1>
      {back ? (
        <Link href={back} className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-slate-600 hover:text-navy-900">
          <ChevronLeft className="size-4" aria-hidden="true" /> Back to your purchase
        </Link>
      ) : null}
      {params.top_up ? <TopUpStatus id={params.top_up} /> : null}
      {/* The sub rail's Crypto item where the store offers no crypto and nothing is held: say so above the money wallet. */}
      {showCrypto && overview.ok && !crypto ? (
        <p className={`${card} text-slate-600`} role="status">
          Crypto wallets are not offered in your country yet. Your money wallet is below.
        </p>
      ) : null}

      {customer && !customer.country ? (
        <div className={card}>
          <p className="font-semibold">Choose your country first</p>
          <p className="mt-1 text-sm text-slate-600">Your wallet is in your country&apos;s currency. Choose it once in your account; it then stays the same.</p>
          <Link href="/account/profile/details#country" className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-brand-500 px-4 font-semibold text-white hover:bg-brand-600">
            Choose your country
          </Link>
        </div>
      ) : !wallet ? (
        <p className={card}>Your wallet cannot be shown right now. Try again shortly.</p>
      ) : (
        <>
          {wallet.wallets.length > 1 || crypto ? (
            // On desktop the sub rail lists the wallets instead.
            <nav aria-label="Your wallets" className={`grid gap-1 rounded-2xl bg-slate-100 p-1 sm:gap-2 lg:hidden ${wallet.wallets.length + (crypto ? 1 : 0) >= 3 ? "grid-cols-3" : "grid-cols-2"}`}>
              {wallet.wallets.map(item => {
                const active = !cryptoTab && item.currency === wallet.currency;
                const query = new URLSearchParams({ ...(item.primary ? {} : { wallet: item.currency }), ...(back ? { back } : {}) }).toString();
                return (
                  <Link
                    key={item.currency}
                    href={`/account/wallet${query ? `?${query}` : ""}`}
                    aria-current={active ? "page" : undefined}
                    className={`flex min-h-14 min-w-0 flex-col justify-center rounded-xl px-3 py-2 ${active ? "bg-white shadow-sm ring-1 ring-slate-200" : "text-slate-600 hover:text-navy-900"}`}
                  >
                    <span className="text-xs font-semibold text-slate-500">{walletLabel(item.currency)}</span>
                    <span className="truncate font-bold text-navy-900">{formatFace(item.balance, item.currency)}</span>
                  </Link>
                );
              })}
              {crypto ? (
                <Link
                  href={`/account/wallet?${new URLSearchParams({ wallet: "crypto", ...(back ? { back } : {}) }).toString()}`}
                  aria-current={cryptoTab ? "page" : undefined}
                  className={`flex min-h-14 min-w-0 flex-col justify-center rounded-xl px-3 py-2 ${cryptoTab ? "bg-white shadow-sm ring-1 ring-slate-200" : "text-slate-600 hover:text-navy-900"}`}
                >
                  <span className="text-xs font-semibold text-slate-500">Crypto</span>
                  <span className="truncate font-bold text-navy-900">{coinsSummary(crypto)}</span>
                </Link>
              ) : null}
            </nav>
          ) : null}
          {cryptoTab ? (
            <CryptoWallets wallets={crypto} activity={cryptoActivity?.ok ? cryptoActivity.data.data : null} exchange={exchange?.ok ? exchange.data : null} />
          ) : (
          <>
          <section aria-label="Balance" className="rounded-3xl bg-navy-900 p-6 text-white">
            {/* Top row: the label on the left, the customer's own bank account (or the link to get one) top right. */}
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
              <p className="flex items-center gap-2 text-sm text-white/70">
                <Wallet className="size-4" aria-hidden="true" /> {wallet.wallets.length > 1 ? (wallet.currency === "USD" ? "US dollar wallet" : `${wallet.currency} wallet`) : "Wallet balance"}
                {wallet.mode === "test" ? " (test)" : ""}
              </p>
              {wallet.enabled && wallet.reserved_accounts_available ? (
                wallet.reserved_accounts[0] ? (
                  <p className="flex items-center gap-1.5 text-sm text-white/80" aria-label="Your bank account number">
                    <Landmark className="size-4 shrink-0" aria-hidden="true" />
                    <span className="font-semibold tracking-wide text-white">{wallet.reserved_accounts[0].account_number}</span>
                    <span>· {wallet.reserved_accounts[0].bank_name}</span>
                  </p>
                ) : (
                  <span className="-mx-2">
                    <BankAccountLink tone="light" />
                  </span>
                )
              ) : null}
            </div>
            <div className="mt-2 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div className="min-w-0">
                <p className="font-display text-4xl font-extrabold">{formatFace(wallet.balance, wallet.currency)}</p>
                <p className="mt-2 text-sm text-white/70">
                  {!wallet.enabled
                    ? "This store now takes payment when you buy. You can still spend what is left here."
                    : wallet.currency !== primary
                      ? `Pay for orders in dollars when you choose: prices in ${primary} are converted at our rate, shown before you pay. Spent only in this store; cannot be withdrawn.`
                      : "You pay for your orders from here. It is spent only in this store and cannot be withdrawn."}
                </p>
              </div>
              {wallet.enabled ? <AddFunds wallet={wallet} amount={params.amount} open={Boolean(back || params.amount)} /> : null}
            </div>
          </section>
          {wallet.enabled && wallet.reserved_accounts_available && !wallet.reserved_accounts.length ? (
            <BankAccountDialog needsBvn={wallet.reserved_account_needs_bvn} />
          ) : null}
          </>
          )}
        </>
      )}

      {cryptoTab ? null : (
      <section aria-labelledby="activity" className={card}>
        <ActivityHeading id="activity" viewAll={activityHref("money")} />
        {activity?.ok && activity.data.data.length ? (
          <MoneyActivityList items={activity.data.data} />
        ) : (
          <p className="text-slate-600">Top-ups and purchases show here.</p>
        )}
      </section>
      )}
    </div>
  );
}
