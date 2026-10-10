import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, ChevronLeft, Clock, Landmark, Wallet } from "lucide-react";
import { formatFace, type StoreList, type StoreWalletTopUp, type StoreWalletTransaction } from "@bitocard/api-client/storefront";
import { BankAccountForm, TopUpForm } from "@/components/app/wallet-forms";
import { customerApi, safeNext } from "@/lib/customer";
import { currentMarket } from "@/lib/market";
import { storeNavigation } from "@/lib/navigation";
import { currentStore } from "@/lib/store";
import { simulateDeposit, simulateTopUp, walletFor } from "@/lib/wallet";

export const metadata: Metadata = { title: "Wallet" };

const date = (iso: string) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
const card = "rounded-3xl bg-white p-5 ring-1 ring-slate-200/70";

type Search = { country?: string; top_up?: string; back?: string; amount?: string };

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
 * The wallet: the balance, topping it up (card, mobile money, Flutterwave, or the customer's own bank account number),
 * and what went in and out. Spent only in this store, never withdrawn. bitocard.com keeps one wallet per market.
 */
export default async function WalletPage({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams;
  const [{ store }, market, navigation] = await Promise.all([currentStore(), currentMarket(), storeNavigation()]);
  // A reseller's store is its own country; bitocard.com the market asked for, else the shopper's, else the first.
  const asked = params.country && /^[A-Z]{2}$/.test(params.country) ? params.country : null;
  const country = store ? null : (asked ?? (market && market !== "global" ? market : (navigation.countries[0]?.code ?? null)));
  const [wallet, activity] = await Promise.all([walletFor(country), customerApi<StoreList<StoreWalletTransaction>>("GET", "/v1/store/wallet/transactions?limit=20")]);
  const back = params.back ? safeNext(params.back, "") : "";

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="sr-only">Wallet</h1>
      {back ? (
        <Link href={back} className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-slate-600 hover:text-[#070f4c]">
          <ChevronLeft className="size-4" aria-hidden="true" /> Back to your purchase
        </Link>
      ) : null}
      {params.top_up ? <TopUpStatus id={params.top_up} /> : null}

      {!store && navigation.countries.length > 1 ? (
        <form className="flex flex-wrap items-end gap-3" aria-label="Choose the wallet's country">
          <label className="space-y-1.5">
            <span className="block text-sm font-semibold">Wallet for</span>
            <select name="country" defaultValue={country ?? ""} className="min-h-12 rounded-xl border border-slate-200 bg-white px-3 text-[15px]">
              {navigation.countries.map(item => (
                <option key={item.code} value={item.code}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="min-h-12 rounded-xl px-4 font-semibold text-[#070f4c] ring-1 ring-slate-200 hover:ring-slate-300">
            Show
          </button>
        </form>
      ) : null}

      {!wallet ? (
        <p className={card}>Your wallet cannot be shown right now. Try again shortly.</p>
      ) : (
        <>
          <section aria-label="Balance" className="rounded-3xl bg-[#070f4c] p-6 text-white">
            <p className="flex items-center gap-2 text-sm text-white/70">
              <Wallet className="size-4" aria-hidden="true" /> Wallet balance{wallet.mode === "test" ? " (test)" : ""}
            </p>
            <p className="mt-2 font-display text-4xl font-extrabold">{formatFace(wallet.balance, wallet.currency)}</p>
            <p className="mt-2 text-sm text-white/70">
              {wallet.enabled
                ? "You pay for your orders from here. It is spent only in this store and cannot be withdrawn."
                : "This store now takes payment when you buy. You can still spend what is left here."}
            </p>
          </section>

          {wallet.enabled ? (
            <section aria-labelledby="top-up" className={card}>
              <h2 id="top-up" className="mb-4 text-lg font-bold">
                Top up
              </h2>
              <TopUpForm country={country} currency={wallet.currency} methods={wallet.top_up_methods} amount={params.amount} sandbox={wallet.mode === "test"} />
            </section>
          ) : null}

          {wallet.enabled && wallet.reserved_accounts_available ? (
            <section aria-labelledby="bank" className={card}>
              <h2 id="bank" className="mb-1 flex items-center gap-2 text-lg font-bold">
                <Landmark className="size-5" aria-hidden="true" /> Your bank account number
              </h2>
              <p className="mb-4 text-sm text-slate-600">Transfer to it from any bank app: the money is added to your wallet once it arrives.</p>
              {wallet.reserved_accounts.length ? (
                <ul className="space-y-3">
                  {wallet.reserved_accounts.map(account => (
                    <li key={account.id} className="rounded-2xl bg-slate-50 p-4">
                      <p className="font-display text-2xl font-extrabold tracking-wide">{account.account_number}</p>
                      <p className="text-sm text-slate-600">
                        {account.bank_name} · {account.account_name}
                      </p>
                      {wallet.mode === "test" ? (
                        <form action={simulateDeposit} className="mt-3 flex flex-wrap items-center gap-2">
                          <input type="hidden" name="id" value={account.id} />
                          <input name="amount" defaultValue="5000" inputMode="decimal" aria-label="Test transfer amount" className="min-h-10 w-28 rounded-xl border border-slate-200 bg-white px-3" />
                          <button type="submit" className="min-h-10 rounded-xl bg-white px-3 font-semibold ring-1 ring-slate-200 hover:ring-slate-300">
                            Simulate a transfer
                          </button>
                        </form>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <BankAccountForm country={country} needsBvn={wallet.reserved_account_needs_bvn} />
              )}
            </section>
          ) : null}
        </>
      )}

      <section aria-labelledby="activity" className={card}>
        <h2 id="activity" className="mb-2 text-lg font-bold">
          Activity
        </h2>
        {activity.ok && activity.data.data.length ? (
          <ul className="divide-y divide-slate-100">
            {activity.data.data.map(item => (
              <li key={item.id} className="flex items-center gap-3 py-3">
                <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${item.amount >= 0 ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                  {item.amount >= 0 ? <ArrowDownLeft className="size-5" aria-hidden="true" /> : <ArrowUpRight className="size-5" aria-hidden="true" />}
                </span>
                <span className="min-w-0 flex-1">
                  {item.checkout_id ? (
                    <Link href={`/account/orders/${item.checkout_id}`} className="block truncate font-semibold hover:underline">
                      {item.description}
                    </Link>
                  ) : (
                    <span className="block truncate font-semibold">{item.description}</span>
                  )}
                  <span className="block text-sm text-slate-500">{date(item.created_at)}</span>
                </span>
                <span className={`shrink-0 font-semibold ${item.amount >= 0 ? "text-emerald-700" : "text-[#070f4c]"}`}>
                  {item.amount >= 0 ? "+" : "−"}
                  {formatFace(Math.abs(item.amount), item.currency)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-slate-600">Top-ups and purchases show here.</p>
        )}
      </section>
    </div>
  );
}
