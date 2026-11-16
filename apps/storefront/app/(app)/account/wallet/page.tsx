import type { Metadata } from "next";
import Link from "next/link";
import { Banknote, ChevronLeft, Landmark, Wallet } from "lucide-react";
import { formatFace, walletName, type StoreList, type StoreWalletTransaction } from "@bitocard/api-client/storefront";
import { bankDepositOptions, myBankDeposits } from "@/lib/bank-deposits";
import { ActivityHeading, MoneyActivityList } from "@/components/app/wallet-activity";
import { DepositRows } from "@/components/app/bank-deposit-status";
import { AddFunds, AddWallet, BankAccountDialog, BankAccountLink, MoveMoney, RemoveWallet } from "@/components/app/wallet-forms";
import { activityHref, recentItems } from "@/lib/activity";
import { currentCustomer, customerApi, safeNext } from "@/lib/customer";
import { TopUpStatus } from "@/components/app/top-up-status";
import { walletCurrencies, walletFor } from "@/lib/wallet";

export const metadata: Metadata = { title: "Wallet" };

const card = "rounded-3xl bg-white p-5 ring-1 ring-slate-200/70";

type Search = { top_up?: string; back?: string; amount?: string; wallet?: string; cancel_error?: string };

/** "US dollars" or the currency's code, as the wallet tabs name them. */
const walletLabel = (currency: string) => (currency === "USD" ? "US dollars" : currency);

/**
 * The wallets: one tab each (the customer's own country's currency, US dollars, then any they added; Add wallet adds
 * another opened currency), the balance of the one shown with Add funds (card, mobile money, Flutterwave, or the
 * customer's own bank account number on the home wallet) and Move money (to another of their wallets, at our rate,
 * shown first), and what went in and out. Spent only in this store, never withdrawn.
 */
export default async function WalletPage({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams;
  // The country wallet unless `?wallet=USD` chose the US dollar one.
  const asked = /^[A-Za-z]{3}$/.test(params.wallet ?? "") ? params.wallet!.toUpperCase() : undefined;
  const [customer, chosen, activity, addable] = await Promise.all([
    currentCustomer(),
    walletFor(asked),
    customerApi<StoreList<StoreWalletTransaction>>("GET", "/v1/store/wallet/transactions?limit=20"),
    walletCurrencies(),
  ]);
  const wallet = chosen ?? (asked ? await walletFor() : null);
  const [deposits, depositList] = wallet?.enabled ? await Promise.all([bankDepositOptions(wallet.currency), myBankDeposits()]) : [null, []];
  // Bank deposits still waiting on the customer or on us.
  const openDeposits = depositList.filter(item => item.status === "awaiting_payment" || item.status === "sent");
  // The money wallets' last 24 hours (a few); everything else is on Transactions.
  const recentMoney = activity.ok ? recentItems(activity.data.data) : [];
  const back = params.back ? safeNext(params.back, "") : "";
  const primary = wallet?.wallets.find(item => item.primary)?.currency ?? wallet?.currency;
  const shown = wallet?.wallets.find(item => item.currency === wallet.currency);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="sr-only">Wallet</h1>
      {back ? (
        <Link href={back} className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-slate-600 hover:text-navy-900">
          <ChevronLeft className="size-4" aria-hidden="true" /> Back to your purchase
        </Link>
      ) : null}
      {params.top_up ? <TopUpStatus id={params.top_up} back={params.wallet ? `/account/wallet?wallet=${encodeURIComponent(params.wallet)}` : "/account/wallet"} cancelError={params.cancel_error} /> : null}
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
          <div className="flex items-center gap-2">
            {/* Every wallet, sliding sideways when there are many; on desktop the sub rail lists them too. */}
            <nav aria-label="Your wallets" className="flex min-w-0 flex-1 gap-1 overflow-x-auto rounded-2xl bg-slate-100 p-1 [scrollbar-width:none] sm:gap-2">
              {wallet.wallets.map(item => {
                const active = item.currency === wallet.currency;
                const query = new URLSearchParams({ ...(item.primary ? {} : { wallet: item.currency }), ...(back ? { back } : {}) }).toString();
                return (
                  <Link
                    key={item.currency}
                    href={`/account/wallet${query ? `?${query}` : ""}`}
                    aria-current={active ? "page" : undefined}
                    className={`flex min-h-14 min-w-32 flex-1 flex-col justify-center rounded-xl px-3 py-2 ${active ? "bg-white shadow-sm ring-1 ring-slate-200" : "text-slate-600 hover:text-navy-900"}`}
                  >
                    <span className="text-xs font-semibold text-slate-500">{walletLabel(item.currency)}</span>
                    <span className="truncate font-bold text-navy-900">{formatFace(item.balance, item.currency)}</span>
                  </Link>
                );
              })}
            </nav>
            {wallet.enabled ? <AddWallet options={addable} /> : null}
          </div>
          <section aria-label="Balance" className="rounded-3xl bg-navy-900 p-6 text-white">
            {/* The customer's own bank account number (or the link to get one) sits above everything, on its own line. */}
            {wallet.enabled && wallet.reserved_accounts_available ? (
              wallet.reserved_accounts[0] ? (
                <p className="mb-3 flex flex-wrap items-center gap-1.5 text-sm text-white/80" aria-label="Your bank account number">
                  <Landmark className="size-4 shrink-0" aria-hidden="true" />
                  <span className="font-semibold tracking-wide text-white">{wallet.reserved_accounts[0].account_number}</span>
                  <span>· {wallet.reserved_accounts[0].bank_name}</span>
                </p>
              ) : (
                <div className="-mx-2 -mt-2 mb-1">
                  <BankAccountLink tone="light" />
                </div>
              )
            ) : null}
            {/* The wallet's name on the left; its actions together in one row, top right. */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="flex items-center gap-2 text-sm text-white/70">
                <Wallet className="size-4" aria-hidden="true" /> {wallet.wallets.length > 1 ? walletName(wallet.currency) : "Wallet balance"}
                {wallet.mode === "test" ? " (test)" : ""}
              </p>
              {wallet.enabled ? (
                <div className="flex flex-wrap items-center gap-2">
                  {wallet.balance > 0 ? <MoveMoney key={wallet.currency} wallet={wallet} /> : null}
                  <AddFunds wallet={wallet} amount={params.amount} open={Boolean(back || params.amount)} bankDeposits={deposits} />
                </div>
              ) : null}
            </div>
            <p className="mt-3 font-display text-4xl font-extrabold">{formatFace(wallet.balance, wallet.currency)}</p>
            <p className="mt-2 max-w-xl text-sm text-white/70">
              {!wallet.enabled
                ? "This store now takes payment when you buy. You can still spend what is left here."
                : wallet.currency !== primary
                  ? `Pay from it when you choose: prices in other currencies are converted at our rate, shown before you pay. Spent only in this store; cannot be withdrawn.`
                  : "You pay for your orders from here. It is spent only in this store and cannot be withdrawn."}
            </p>
          </section>
          {wallet.enabled && wallet.reserved_accounts_available && !wallet.reserved_accounts.length ? (
            <BankAccountDialog needsBvn={wallet.reserved_account_needs_bvn} />
          ) : null}
          {depositList.length ? (
            <section aria-labelledby="open-deposits" className={card}>
              {/* The ones still in progress here; View all opens Deposits with every one and its status. */}
              <ActivityHeading id="open-deposits" note={openDeposits.length ? "In progress" : undefined} viewAll="/account/wallet/deposits">
                <span className="flex items-center gap-2">
                  <Banknote className="size-5" aria-hidden="true" /> Bank deposits
                </span>
              </ActivityHeading>
              {openDeposits.length ? <DepositRows items={openDeposits} /> : <p className="text-sm text-slate-600">None in progress. View all to see past deposits and their status.</p>}
            </section>
          ) : null}
          {shown?.removable ? <RemoveWallet currency={wallet.currency} /> : null}
        </>
      )}

      <section aria-labelledby="activity" className={card}>
        {/* Only the last day here, to keep the page short; View all opens Transactions with everything. */}
        <ActivityHeading id="activity" note="Last 24 hours" viewAll={activityHref()} />
        {recentMoney.length ? (
          <MoneyActivityList items={recentMoney} />
        ) : (
          <p className="text-slate-600">{activity.ok && activity.data.data.length ? "Nothing in the last 24 hours. View all for older transactions." : "Top-ups and purchases show here."}</p>
        )}
      </section>
    </div>
  );
}
