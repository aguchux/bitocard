import type { Metadata } from "next";
import Link from "next/link";
import { formatCrypto, type StoreCryptoWallets, type StoreList, type StoreP2pMarket } from "@bitocard/api-client/storefront";
import { PostAdForm } from "@bitocard/crypto-ui/forms";
import { CryptoDeclaration, cardClass } from "@bitocard/crypto-ui/trade-views";
import { AccountLink, AccountShell } from "@/components/account-shell";
import { requireCustomer, tradableAssets } from "@/lib/account";
import { customerApi } from "@/lib/customer";
import { declareCrypto } from "@/lib/trade";

export const metadata: Metadata = { title: "Post an ad", robots: { index: false, follow: false } };

type Search = { side?: string; asset?: string; currency?: string; market?: string };

/** Posting an ad in a market the customer may trade in (their own by default), in one of its currencies. */
export default async function PostAdPage({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams;
  await requireCustomer(`/ads/post?${new URLSearchParams(params as Record<string, string>)}`);
  const [overview, open] = await Promise.all([customerApi<StoreCryptoWallets>("GET", "/v1/store/crypto"), customerApi<StoreList<StoreP2pMarket>>("GET", "/v1/store/p2p/markets")]);
  const wallets = overview.ok ? overview.data : null;
  const assets = tradableAssets(wallets);
  const markets = open.ok ? open.data.data : [];
  const chosen = markets.find(item => !item.home && item.market === (params.market ?? "").toUpperCase()) ?? markets.find(item => item.home) ?? markets[0];
  const market = chosen && !chosen.home ? chosen.market : "";
  const currencies = chosen?.currencies ?? [];
  const currency = currencies.includes((params.currency ?? "").toUpperCase()) ? params.currency!.toUpperCase() : (currencies[0] ?? "USD");
  const asset = assets.includes((params.asset ?? "").toUpperCase()) ? params.asset!.toUpperCase() : (assets[0] ?? "USDT");
  const side = params.side === "sell" ? "sell" : "buy";
  const coin = wallets?.assets.find(item => item.asset === asset);
  const route = (next: Partial<Search>) => `/ads/post?${new URLSearchParams({ side, asset, currency, ...(market ? { market } : {}), ...next })}`;

  let body;
  if (!wallets || !chosen || !assets.length) body = <p className={cardClass}>You cannot post ads in this market right now.</p>;
  else if (wallets.frozen) body = <p className={cardClass}>Your crypto account is frozen. Contact support to find out why.</p>;
  else if (!wallets.verified)
    body = (
      <p className={cardClass}>
        Verify your identity before trading.{" "}
        <AccountLink place="verification" className="font-semibold text-brand-700 underline">
          Verify my identity
        </AccountLink>
      </p>
    );
  else if (!wallets.declaration.declared) body = <CryptoDeclaration version={wallets.declaration.version} action={declareCrypto} />;
  else
    body = (
      <section className={`${cardClass} space-y-4`}>
        <p className="text-sm text-slate-600">
          {side === "sell" ? `I want to sell ${asset} for ${currency}` : `I want to buy ${asset} with ${currency}`} in {chosen.market === "WW" ? "the global market" : chosen.name}.
          {side === "sell" ? ` Available: ${formatCrypto(coin?.available ?? "0", asset)}.` : ""}
        </p>
        {currencies.length > 1 ? (
          <div className="grid grid-cols-2 gap-2">
            {currencies.map(value => (
              <Link key={value} href={route({ currency: value })} aria-current={currency === value ? "page" : undefined} className={`flex min-h-11 items-center justify-center rounded-xl border text-sm font-semibold ${currency === value ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200"}`}>
                {value}
              </Link>
            ))}
          </div>
        ) : null}
        <PostAdForm key={`${market}-${side}-${asset}-${currency}`} side={side} asset={asset} currency={currency} market={market} suggestedAmount={side === "sell" && Number(coin?.available) > 0 ? coin!.available : undefined} />
      </section>
    );
  return (
    <AccountShell title="Post an ad" current="/ads">
      {body}
    </AccountShell>
  );
}
