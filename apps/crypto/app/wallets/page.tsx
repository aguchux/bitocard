import type { Metadata } from "next";
import Link from "next/link";
import { formatCrypto, type StoreCryptoWallets, type StoreP2pProfile } from "@bitocard/api-client/storefront";
import { CoinBadge } from "@bitocard/crypto-ui/coins";
import { NicknameForm } from "@bitocard/crypto-ui/forms";
import { CryptoDeclaration, cardClass } from "@bitocard/crypto-ui/trade-views";
import { AccountLink, AccountShell } from "@/components/account-shell";
import { requireCustomer } from "@/lib/account";
import { customerApi } from "@/lib/customer";
import { declareCrypto } from "@/lib/trade";

export const metadata: Metadata = { title: "Wallets", robots: { index: false, follow: false } };

const button = "inline-flex min-h-11 items-center justify-center rounded-xl px-4 text-sm font-semibold ring-1 ring-slate-300 hover:ring-slate-400";

/**
 * The customer's wallets for trading: each coin (available, in ads, frozen), their P2P money in every currency they
 * hold, and their nickname. Adding money, deposits, withdrawals and cash out are on this site.
 */
export default async function WalletsPage() {
  await requireCustomer("/wallets");
  const [overview, profile] = await Promise.all([customerApi<StoreCryptoWallets>("GET", "/v1/afrippa/crypto"), customerApi<StoreP2pProfile>("GET", "/v1/afrippa/p2p/profile")]);
  if (!overview.ok) {
    return (
      <AccountShell title="Wallets" current="/wallets">
        <p className={cardClass}>Your wallets cannot be shown right now. Try again shortly.</p>
      </AccountShell>
    );
  }
  const wallets = overview.data;
  return (
    <AccountShell title="Wallets" current="/wallets">
      {!wallets.verified ? (
        <p className={cardClass}>
          Verify your identity before trading.{" "}
          <AccountLink place="verification" className="font-semibold text-brand-700 underline">
            Verify my identity
          </AccountLink>
        </p>
      ) : !wallets.declaration.declared ? (
        <CryptoDeclaration version={wallets.declaration.version} action={declareCrypto} />
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Link href="/deposit" className={button}>
          Deposit coins
        </Link>
        <Link href="/withdraw" className={button}>
          Withdraw coins
        </Link>
      </div>
      <section className={cardClass} aria-labelledby="coins">
        <h2 id="coins" className="font-semibold">
          Coins
        </h2>
        <ul className="mt-2 divide-y divide-slate-100">
          {wallets.assets.map(coin => (
            <li key={coin.asset} className="flex items-center gap-3 py-3">
              <CoinBadge asset={coin.asset} />
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{formatCrypto(coin.available, coin.asset)}</span>
                <span className="block text-xs text-slate-500">
                  {formatCrypto(coin.locked, coin.asset)} in ads{Number(coin.frozen) > 0 ? ` · ${formatCrypto(coin.frozen, coin.asset)} frozen` : ""}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </section>
      {profile.ok ? (
        <section className={cardClass} aria-labelledby="nickname">
          <h2 id="nickname" className="mb-3 font-semibold">
            You trade as {profile.data.nickname}
          </h2>
          {profile.data.nickname_chosen ? <p className="text-sm text-slate-600">Your nickname is set.</p> : <NicknameForm current={profile.data.nickname} />}
        </section>
      ) : null}
    </AccountShell>
  );
}
