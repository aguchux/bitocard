import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { formatCrypto, type StoreCryptoDeposit, type StoreCryptoDepositAddress, type StoreCryptoNetwork, type StoreCryptoWallets, type StoreList } from "@bitocard/api-client/storefront";
import { card, CoinBadge, CoinPicker, CryptoGate, CryptoNav, date, tradableAssets } from "@/components/app/crypto";
import { DepositAddress } from "@/components/app/deposit-address";
import { customerApi } from "@/lib/customer";
import { addressQr } from "@/lib/qr";

export const metadata: Metadata = { title: "Deposit crypto" };

type Search = { asset?: string; chain?: string };

const statusLabel: Record<StoreCryptoDeposit["status"], string> = { pending: "Confirming", credited: "Arrived", ignored: "Too small to credit", failed: "Not found on chain" };

/**
 * Depositing crypto: choose the coin, then its network, then the customer's own address for it (with its QR code,
 * drawn here). The address is theirs for good; showing it watches it for deposits. Their recent deposits show below.
 */
export default async function DepositPage({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams;
  const overview = await customerApi<StoreCryptoWallets>("GET", "/v1/store/crypto");
  const wallets = overview.ok ? overview.data : null;
  // Only coins still open for deposits (a coin switched off is listed while held, but takes no deposits).
  const assets = tradableAssets(wallets);
  const asked = (params.asset ?? "").toUpperCase();
  const asset = assets.includes(asked) ? asked : (assets[0] ?? "USDT");
  const blocked = !wallets || !wallets.enabled || wallets.frozen || !wallets.verified;
  const networks = blocked ? null : await customerApi<StoreList<StoreCryptoNetwork>>("GET", `/v1/store/crypto/deposit-networks?asset=${encodeURIComponent(asset)}`);
  const options = networks?.ok ? networks.data.data : [];
  const chain = options.find(item => item.chain === (params.chain ?? "").toUpperCase())?.chain ?? (options.length === 1 ? options[0].chain : null);
  const address = chain ? await customerApi<StoreCryptoDepositAddress>("POST", "/v1/store/crypto/deposit-addresses", { asset, chain }) : null;
  const qr = address?.ok ? await addressQr(address.data.address) : null;
  const deposits = blocked ? null : await customerApi<StoreList<StoreCryptoDeposit>>("GET", "/v1/store/crypto/deposits");
  const network = options.find(item => item.chain === chain);

  return (
    <div className="mx-auto max-w-lg space-y-5">
      <Link href="/account/crypto/wallets" className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-slate-600 hover:text-navy-900">
        <ChevronLeft className="size-4" aria-hidden="true" /> Wallets
      </Link>
      <h1 className="font-display text-2xl font-extrabold text-navy-900">Deposit crypto{wallets?.mode === "test" ? " (test network)" : ""}</h1>
      <CryptoNav current="/account/crypto/deposit" />
      {blocked ? <CryptoGate wallets={wallets} /> : null}
      {!blocked ? (
        <>
          <CoinPicker assets={assets} wallets={wallets} current={asset} href={code => `/account/crypto/deposit?asset=${code}`} label="Coin to deposit" />
          {options.length ? (
            <section className={card} aria-labelledby="network">
              <h2 id="network" className="mb-3 font-bold">
                Network
              </h2>
              <div className="grid gap-2 sm:grid-cols-2">
                {options.map(item => (
                  <Link
                    key={item.chain}
                    href={`/account/crypto/deposit?asset=${asset}&chain=${item.chain}`}
                    aria-current={item.chain === chain ? "true" : undefined}
                    className="flex min-h-12 flex-col justify-center rounded-xl px-3 py-2 ring-1 ring-slate-200 aria-[current=true]:bg-pink-50 aria-[current=true]:ring-2 aria-[current=true]:ring-brand-500"
                  >
                    <span className="font-semibold">{item.name}</span>
                    <span className="text-xs text-slate-500">{item.token ?? `${asset} itself`}</span>
                  </Link>
                ))}
              </div>
            </section>
          ) : (
            <p className={card}>{asset} deposits are not open yet. Buy it on the P2P market instead.</p>
          )}
          {address && !address.ok ? (
            <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
              {address.message}
            </p>
          ) : null}
          {address?.ok && network ? (
            <DepositAddress
              key={`${asset}:${network.chain}`}
              asset={asset}
              network={network.name}
              token={network.token ?? null}
              address={address.data.address}
              contract={address.data.contract ?? null}
              confirmations={network.confirmations}
              qr={qr}
            />
          ) : null}
          {deposits?.ok && deposits.data.data.length ? (
            <section className={card} aria-labelledby="recent">
              <h2 id="recent" className="mb-1 font-bold">
                Recent deposits
              </h2>
              <ul className="divide-y divide-slate-100">
                {deposits.data.data.map(item => (
                  <li key={item.id} className="flex items-center gap-3 py-3">
                    <CoinBadge asset={item.asset} />
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{formatCrypto(item.amount, item.asset)}</span>
                      <span className="block truncate text-xs text-slate-500">
                        {item.network} · {date(item.created_at)}
                      </span>
                    </span>
                    <span className={`shrink-0 text-sm font-semibold ${item.status === "credited" ? "text-emerald-700" : item.status === "pending" ? "text-amber-700" : "text-slate-500"}`}>
                      {statusLabel[item.status]}
                      {item.status === "pending" && item.confirmations_needed ? ` ${item.confirmations}/${item.confirmations_needed}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
