import type { Metadata } from "next";
import Link from "next/link";
import { randomUUID } from "node:crypto";
import { ShieldCheck } from "lucide-react";
import { formatFace, type StoreCustomerBankAccount, type StoreCustomerPayout, type StoreList, type StoreP2pCash } from "@bitocard/api-client/storefront";
import { PayoutAccountForm, PayOutForm, RemovePayoutAccount, SimulatePayout } from "@/components/app/shop/payout-forms";
import { ShopPills, ShopTitle } from "@/components/app/shop/shop-nav";
import { customerApi } from "@/lib/customer";
import { requireShop } from "@/lib/shop-server";

export const metadata: Metadata = { title: "Payouts" };

const card = "rounded-2xl border border-slate-200 bg-white p-5";
const when = (iso: string) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
const statusLabel: Record<StoreCustomerPayout["status"], string> = { pending: "Sending", processing: "Sending", paid: "Paid", failed: "Failed" };

/**
 * Paying the money from the customer's Safe pay sales out to their own bank account (`/v1/store/cash`): what can be
 * paid out now and what waits for the payout hold, their bank accounts (in their verified name) and their payouts.
 */
export default async function PayoutsPage() {
  const { shop } = await requireShop("/shop/payouts");
  const [cash, accounts, payouts] = await Promise.all([
    customerApi<StoreP2pCash>("GET", "/v1/store/cash"),
    customerApi<StoreList<StoreCustomerBankAccount>>("GET", "/v1/store/cash/bank-accounts"),
    customerApi<StoreList<StoreCustomerPayout>>("GET", "/v1/store/cash/payouts"),
  ]);
  const banks = cash.ok ? await customerApi<StoreList<{ code: string; name: string }>>("GET", "/v1/store/cash/banks") : null;
  const money = cash.ok ? cash.data : null;
  const saved = accounts.ok ? accounts.data.data : [];

  return (
    <div className="grid max-w-2xl gap-5">
      <ShopTitle title="Payouts" note="The money from your sales, paid into your own bank account." post={false} />
      <ShopPills shop={shop} active="/shop/payouts" />
      {!cash.ok && cash.code === "customer_verification_required" ? (
        <div className={card}>
          <p className="flex items-center gap-2 font-semibold">
            <ShieldCheck className="size-5 text-brand-500" aria-hidden="true" /> Verify your identity to get paid
          </p>
          <p className="mt-1 text-sm text-slate-600">We pay only into an account in your own name, so we need a quick identity check first, once.</p>
          <Link href="/account/verification" className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-navy-900 px-4 font-semibold text-white hover:bg-navy-700">
            Verify my identity
          </Link>
        </div>
      ) : !cash.ok ? (
        <p className={card} role="alert">
          {cash.message}
        </p>
      ) : null}
      {money ? (
        <section className={card} aria-label="Your money">
          {money.mode === "test" ? <p className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">Test mode: nothing here is real money.</p> : null}
          <p className="text-sm text-slate-500">You can pay out now</p>
          <p className="text-3xl font-extrabold">{formatFace(money.available, money.currency)}</p>
          {money.held > 0 ? (
            <p className="mt-1 text-sm text-slate-600">
              {formatFace(money.held, money.currency)} more becomes available {money.hold_days} days after each sale.
            </p>
          ) : null}
          <p className="mt-1 text-xs text-slate-500">The smallest payout is {formatFace(money.minimum, money.currency)}.</p>
        </section>
      ) : null}
      {money && saved.length ? (
        <section className={card} aria-labelledby="pay-out">
          <h2 id="pay-out" className="mb-3 font-bold">
            Pay out
          </h2>
          <PayOutForm
            nonce={randomUUID()}
            currency={money.currency}
            available={formatFace(money.available, money.currency)}
            accounts={saved.map(item => ({ id: item.id, label: `${item.bank_name} ••••${item.account_number_last4}`, ready: item.ready, from: when(item.payouts_available_from) }))}
          />
        </section>
      ) : null}
      {money ? (
        <section className={card} aria-labelledby="accounts">
          <h2 id="accounts" className="mb-1 font-bold">
            Your bank accounts
          </h2>
          {saved.length ? (
            <ul className="mb-4 divide-y divide-slate-100">
              {saved.map(item => (
                <li key={item.id} className="flex items-center gap-3 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">
                      {item.bank_name} ••••{item.account_number_last4}
                    </span>
                    <span className="block truncate text-xs text-slate-500">{item.account_name}</span>
                  </span>
                  <RemovePayoutAccount id={item.id} label={`${item.bank_name} ending ${item.account_number_last4}`} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="mb-3 text-sm text-slate-600">Add the bank account to be paid into. It must be in your own name.</p>
          )}
          {banks?.ok ? <PayoutAccountForm banks={banks.data.data} /> : banks ? <p className="text-sm text-red-700">{banks.message}</p> : null}
        </section>
      ) : null}
      {payouts.ok && payouts.data.data.length ? (
        <section className={card} aria-labelledby="payouts">
          <h2 id="payouts" className="mb-1 font-bold">
            Payouts
          </h2>
          <ul className="divide-y divide-slate-100">
            {payouts.data.data.map(item => (
              <li key={item.id} className="flex flex-wrap items-center gap-3 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{formatFace(item.amount, item.currency)}</span>
                  <span className="block truncate text-xs text-slate-500">
                    {item.bank_account ? `${item.bank_account.bank_name} ••••${item.bank_account.account_number_last4} · ` : ""}
                    {when(item.created_at)}
                  </span>
                  {item.failure_reason ? <span className="block text-xs text-red-700">{item.failure_reason}</span> : null}
                </span>
                <span className={`shrink-0 text-sm font-semibold ${item.status === "paid" ? "text-emerald-700" : item.status === "failed" ? "text-slate-500" : "text-amber-700"}`}>{statusLabel[item.status]}</span>
                {item.mode === "test" && (item.status === "pending" || item.status === "processing") ? <SimulatePayout id={item.id} /> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
