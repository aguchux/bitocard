import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, ChevronLeft, Clock, Landmark, Wallet } from "lucide-react";
import { formatFace, type StoreList, type StoreWalletTopUp, type StoreWalletTransaction } from "@bitocard/api-client/storefront";
import { AddFunds, BankAccountDialog, BankAccountLink } from "@/components/app/wallet-forms";
import { currentCustomer, customerApi, safeNext } from "@/lib/customer";
import { simulateTopUp, walletFor } from "@/lib/wallet";

export const metadata: Metadata = { title: "Wallet" };

const date = (iso: string) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
const card = "rounded-3xl bg-white p-5 ring-1 ring-slate-200/70";

type Search = { top_up?: string; back?: string; amount?: string };

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
export default async function WalletPage({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams;
  const [customer, wallet, activity] = await Promise.all([currentCustomer(), walletFor(), customerApi<StoreList<StoreWalletTransaction>>("GET", "/v1/store/wallet/transactions?limit=20")]);
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

      {customer && !customer.country ? (
        <div className={card}>
          <p className="font-semibold">Choose your country first</p>
          <p className="mt-1 text-sm text-slate-600">Your wallet is in your country&apos;s currency. Choose it once in your account; it then stays the same.</p>
          <Link href="/account/profile#country" className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-[#ff2382] px-4 font-semibold text-white hover:bg-[#e8116d]">
            Choose your country
          </Link>
        </div>
      ) : !wallet ? (
        <p className={card}>Your wallet cannot be shown right now. Try again shortly.</p>
      ) : (
        <>
          <section aria-label="Balance" className="rounded-3xl bg-[#070f4c] p-6 text-white">
            {/* Top row: the label on the left, the customer's own bank account (or the link to get one) top right. */}
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
              <p className="flex items-center gap-2 text-sm text-white/70">
                <Wallet className="size-4" aria-hidden="true" /> Wallet balance{wallet.mode === "test" ? " (test)" : ""}
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
                  {wallet.enabled
                    ? "You pay for your orders from here. It is spent only in this store and cannot be withdrawn."
                    : "This store now takes payment when you buy. You can still spend what is left here."}
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
