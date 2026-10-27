import type { Metadata } from "next";
import { Landmark } from "lucide-react";
import { formatFace, type StoreWallet } from "@bitocard/api-client/storefront";
import { cardClass } from "@bitocard/crypto-ui/trade-views";
import { BankAccountForm, TopUpForm } from "@bitocard/crypto-ui/top-up-forms";
import { TopUpStatus } from "@bitocard/crypto-ui/top-up-views";
import { UnderlineTabs } from "@bitocard/ui/underline-tabs";
import { AccountLink, AccountShell } from "@/components/account-shell";
import { requireCustomer } from "@/lib/account";
import { customerApi } from "@/lib/customer";
import { cancelTopUp, openBankAccount, simulateDeposit, simulateTopUp, topUpWallet } from "@/lib/top-up";

export const metadata: Metadata = { title: "Add money", robots: { index: false, follow: false } };

type Search = { wallet?: string; top_up?: string; cancel_error?: string; amount?: string };

/** "US dollars" or the country's currency code, as the wallet tabs name them. */
const walletLabel = (currency: string) => (currency === "USD" ? "US dollars" : currency);

/**
 * Adding money to the customer's BitoCard wallets (their country's currency and US dollars): by card or mobile money
 * through a payment page, or by transfer to their own bank account number where their country offers one. Wallet
 * money pays for trades on the P2P market and in BitoCard's store; it is never withdrawn (money from selling is).
 */
export default async function AddMoneyPage({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams;
  await requireCustomer("/add-money");
  const asked = /^[A-Za-z]{3}$/.test(params.wallet ?? "") ? params.wallet!.toUpperCase() : undefined;
  const result = await customerApi<StoreWallet>("GET", `/v1/store/wallet${asked ? `?${new URLSearchParams({ currency: asked })}` : ""}`);

  if (!result.ok) {
    return (
      <AccountShell title="Add money" current="/wallets">
        {result.code === "country_required" ? (
          <p className={cardClass}>
            Choose your country first: your wallets are in its currency.{" "}
            <AccountLink place="profile" className="font-semibold text-brand-700 underline">
              Choose my country
            </AccountLink>
          </p>
        ) : (
          <p className={cardClass}>Your wallets cannot be shown right now. Try again shortly.</p>
        )}
      </AccountShell>
    );
  }

  const wallet = result.data;
  const sandbox = wallet.mode === "test";
  const primary = wallet.wallets.find(item => item.currency === wallet.currency)?.primary ?? true;
  const back = primary ? "/add-money" : `/add-money?wallet=${encodeURIComponent(wallet.currency)}`;
  const tabs = wallet.wallets.map(item => ({ href: item.primary ? "/add-money" : `/add-money?wallet=${encodeURIComponent(item.currency)}`, label: walletLabel(item.currency) }));

  return (
    <AccountShell title="Add money" current="/wallets">
      {tabs.length > 1 ? <UnderlineTabs label="Wallets" tabs={tabs} current={back} /> : null}
      {params.top_up ? <TopUpStatus api={customerApi} id={params.top_up} back={back} cancelError={params.cancel_error} cancel={cancelTopUp} simulate={simulateTopUp} /> : null}
      <section className="rounded-3xl bg-navy-900 p-5 text-white" aria-label="Balance">
        <p className="text-sm text-pink-200">{walletLabel(wallet.currency)} wallet</p>
        <p className="font-display text-3xl font-extrabold">{formatFace(wallet.balance, wallet.currency)}</p>
        <p className="mt-1 text-xs text-slate-300">Pays for trades on the P2P market. Money you get from selling is P2P money, which you can cash out.</p>
      </section>
      {wallet.enabled ? (
        <section className={cardClass} aria-labelledby="top-up">
          <h2 id="top-up" className="mb-3 font-semibold">
            Top up
          </h2>
          <TopUpForm
            action={topUpWallet}
            currency={wallet.currency}
            primary={primary}
            methods={wallet.top_up_methods}
            amount={params.amount}
            sandbox={sandbox}
            hint="Spent on BitoCard: on the P2P market and in BitoCard's store. Wallet money cannot be withdrawn."
          />
        </section>
      ) : (
        <p className={cardClass}>Top-ups are not open in your country yet.</p>
      )}
      {wallet.enabled && wallet.reserved_accounts_available && primary ? (
        <section className={cardClass} aria-labelledby="bank">
          <h2 id="bank" className="mb-1 flex items-center gap-2 font-semibold">
            <Landmark className="size-5" aria-hidden="true" /> Bank transfer
          </h2>
          {wallet.reserved_accounts.length ? (
            <>
              <p className="mb-3 text-sm text-slate-600">Transfer to your account number from any bank app: the money is added to your wallet once it arrives.</p>
              <ul className="space-y-3">
                {wallet.reserved_accounts.map(account => (
                  <li key={account.id} className="rounded-2xl bg-slate-50 p-4">
                    <p className="font-display text-2xl font-extrabold tracking-wide">{account.account_number}</p>
                    <p className="text-sm text-slate-600">
                      {account.bank_name} · {account.account_name}
                    </p>
                    {sandbox ? (
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
            </>
          ) : (
            <>
              <p className="mb-3 text-sm text-slate-600">A bank account number in your name, free. Transfer to it from any bank app and the money is added to your wallet once it arrives.</p>
              <BankAccountForm action={openBankAccount} needsBvn={wallet.reserved_account_needs_bvn} />
            </>
          )}
        </section>
      ) : null}
    </AccountShell>
  );
}
