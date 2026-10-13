import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, ChevronLeft, Clock, Trash2 } from "lucide-react";
import { formatCrypto, type StoreCryptoWallets, type StoreCryptoWithdrawal, type StoreList, type StoreWithdrawalAddress, type StoreWithdrawalNetworks } from "@bitocard/api-client/storefront";
import { card, CoinBadge, CryptoGate, CryptoNav, date, withdrawableAssets, withdrawalStatus } from "@/components/app/crypto";
import { ActionButton, AddWithdrawalAddressForm, WithdrawForm } from "@/components/app/crypto-forms";
import { removeWithdrawalAddress } from "@/lib/crypto-actions";
import { customerApi } from "@/lib/customer";

export const metadata: Metadata = { title: "Withdraw crypto" };

type Search = { asset?: string; chain?: string };

/**
 * Withdrawing crypto: the coin, its network (with BitoCard's fee and the minimum), then one of the customer's saved
 * addresses (new ones usable after 24 hours) and the amount. The next step shows the total before anything moves, and
 * an emailed code confirms it.
 */
export default async function WithdrawPage({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams;
  const overview = await customerApi<StoreCryptoWallets>("GET", "/v1/store/crypto");
  const wallets = overview.ok ? overview.data : null;
  // What they hold, plus every tradable coin while crypto is open (a coin switched off can still be withdrawn).
  const assets = withdrawableAssets(wallets);
  const asked = (params.asset ?? "").toUpperCase();
  const asset = assets.includes(asked) ? asked : (wallets?.assets.find(item => Number(item.available) > 0)?.asset ?? assets[0] ?? "USDT");
  const balance = wallets?.assets.find(item => item.asset === asset);
  // Withdrawing needs no crypto switch while they hold coins: only a verified, unfrozen account.
  const blocked = !wallets || assets.length === 0 || wallets.frozen || !wallets.verified;
  const networks = blocked ? null : await customerApi<StoreWithdrawalNetworks>("GET", `/v1/store/crypto/withdrawal-networks?asset=${encodeURIComponent(asset)}`);
  const options = networks?.ok ? networks.data.data : [];
  const network = options.find(item => item.chain === (params.chain ?? "").toUpperCase()) ?? (options.length === 1 ? options[0] : null);
  const saved = blocked ? null : await customerApi<StoreList<StoreWithdrawalAddress>>("GET", "/v1/store/crypto/withdrawal-addresses");
  const addresses = saved?.ok ? saved.data.data.filter(item => item.chain === network?.chain) : [];
  const ready = addresses.filter(item => item.ready);
  const history = blocked ? null : await customerApi<StoreList<StoreCryptoWithdrawal>>("GET", "/v1/store/crypto/withdrawals");

  return (
    <div className="mx-auto max-w-lg space-y-5">
      <Link href="/account/crypto" className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-slate-600 hover:text-[#070f4c]">
        <ChevronLeft className="size-4" aria-hidden="true" /> Crypto
      </Link>
      <h1 className="font-display text-2xl font-extrabold text-[#070f4c]">Withdraw crypto{wallets?.mode === "test" ? " (test network)" : ""}</h1>
      <CryptoNav current="/account/crypto/withdraw" />
      {blocked ? <CryptoGate wallets={wallets} withdraw /> : null}
      {!blocked ? (
        <>
          <nav aria-label="Coin" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
            {assets.map(code => (
              <Link
                key={code}
                href={`/account/crypto/withdraw?asset=${code}`}
                aria-current={code === asset ? "page" : undefined}
                className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-full bg-white pr-3 pl-1 text-sm font-semibold ring-1 ring-slate-200 aria-[current=page]:ring-2 aria-[current=page]:ring-[#070f4c]"
              >
                <CoinBadge asset={code} size="size-8" /> {code}
              </Link>
            ))}
          </nav>
          {balance ? (
            <p className="text-sm text-slate-600">
              Available: <span className="font-semibold text-[#070f4c]">{formatCrypto(balance.available, asset)}</span>
              {networks?.ok ? ` · You can send up to ${formatCrypto(networks.data.remaining_today, asset)} more today` : ""}
            </p>
          ) : null}
          {options.length ? (
            <section className={card} aria-labelledby="network">
              <h2 id="network" className="mb-3 font-bold">
                Network
              </h2>
              <div className="grid gap-2 sm:grid-cols-2">
                {options.map(item => (
                  <Link
                    key={item.chain}
                    href={`/account/crypto/withdraw?asset=${asset}&chain=${item.chain}`}
                    aria-current={item.chain === network?.chain ? "true" : undefined}
                    className="flex min-h-12 flex-col justify-center rounded-xl px-3 py-2 ring-1 ring-slate-200 aria-[current=true]:bg-pink-50 aria-[current=true]:ring-2 aria-[current=true]:ring-[#ff2382]"
                  >
                    <span className="font-semibold">{item.name}</span>
                    <span className="text-xs text-slate-500">Fee {formatCrypto(item.fee, asset)}</span>
                  </Link>
                ))}
              </div>
            </section>
          ) : (
            <p className={card}>{asset} withdrawals are not open yet.</p>
          )}
          {network ? (
            <>
              <section className={card} aria-labelledby="send">
                <h2 id="send" className="mb-3 font-bold">
                  Send {asset} on {network.name}
                </h2>
                {ready.length ? (
                  <WithdrawForm asset={asset} chain={network.chain} addresses={ready} minimum={formatCrypto(network.minimum)} />
                ) : (
                  <p className="text-sm text-slate-600">Save an address below first. You can send to it 24 hours after you add it.</p>
                )}
                <p className="mt-4 flex gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <span>Only send to an address that takes {asset} on {network.name}. Crypto sent to the wrong address or network cannot be got back.</span>
                </p>
              </section>
              <section className={card} aria-labelledby="addresses">
                <h2 id="addresses" className="mb-1 font-bold">
                  Your {network.name} addresses
                </h2>
                {addresses.length ? (
                  <ul className="mb-4 divide-y divide-slate-100">
                    {addresses.map(item => (
                      <li key={item.id} className="flex items-center gap-3 py-3">
                        <span className="min-w-0 flex-1">
                          <span className="block font-semibold">{item.label}</span>
                          <span className="block truncate font-mono text-xs text-slate-500">{item.address}</span>
                          {!item.ready ? (
                            <span className="mt-0.5 inline-flex items-center gap-1 text-xs text-amber-700">
                              <Clock className="size-3.5" aria-hidden="true" /> Usable from {date(item.usable_from)}
                            </span>
                          ) : null}
                        </span>
                        <ActionButton
                          action={removeWithdrawalAddress}
                          fields={{ id: item.id }}
                          label={`Remove ${item.label}`}
                          className="inline-flex size-11 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 hover:text-red-700"
                        >
                          <Trash2 className="size-4" aria-hidden="true" />
                        </ActionButton>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <AddWithdrawalAddressForm chain={network.chain} network={network.name} />
              </section>
            </>
          ) : null}
          {history?.ok && history.data.data.length ? (
            <section className={card} aria-labelledby="recent">
              <h2 id="recent" className="mb-1 font-bold">
                Recent withdrawals
              </h2>
              <ul className="divide-y divide-slate-100">
                {history.data.data.map(item => (
                  <li key={item.id}>
                    <Link href={`/account/crypto/withdrawals/${item.id}`} className="flex items-center gap-3 py-3">
                      <CoinBadge asset={item.asset} />
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold">{formatCrypto(item.amount, item.asset)}</span>
                        <span className="block truncate text-xs text-slate-500">
                          {item.network} · {date(item.created_at)}
                        </span>
                      </span>
                      <span className={`shrink-0 text-sm font-semibold ${item.status === "completed" ? "text-emerald-700" : ["failed", "rejected", "cancelled"].includes(item.status) ? "text-slate-500" : "text-amber-700"}`}>
                        {withdrawalStatus[item.status]}
                      </span>
                    </Link>
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
