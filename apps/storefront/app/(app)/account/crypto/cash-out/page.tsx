import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ShieldCheck, Trash2 } from "lucide-react";
import { formatFace, type StoreCustomerBankAccount, type StoreCustomerPayout, type StoreList, type StoreP2pCash } from "@bitocard/api-client/storefront";
import { randomUUID } from "node:crypto";
import { card, CryptoNav, date } from "@/components/app/crypto";
import { ActionButton, CashOutAccountForm, CashOutForm } from "@/components/app/crypto-forms";
import { removeCashOutAccount, simulateCashOut } from "@/lib/crypto-actions";
import { customerApi } from "@/lib/customer";

export const metadata: Metadata = { title: "Cash out" };

const statusLabel: Record<StoreCustomerPayout["status"], string> = { pending: "Sending", processing: "Sending", paid: "Paid", failed: "Failed" };

/**
 * Paying P2P money (from selling crypto) out to the customer's own bank account: what can be paid out now and what
 * waits for the payout hold, their bank accounts (in their own name) and their payouts.
 */
export default async function CashOutPage() {
  const cash = await customerApi<StoreP2pCash>("GET", "/v1/store/crypto/cash");
  const accounts = await customerApi<StoreList<StoreCustomerBankAccount>>("GET", "/v1/store/crypto/cash/bank-accounts");
  const banks = cash.ok ? await customerApi<StoreList<{ code: string; name: string }>>("GET", "/v1/store/crypto/cash/banks") : null;
  const payouts = await customerApi<StoreList<StoreCustomerPayout>>("GET", "/v1/store/crypto/cash/payouts");
  const money = cash.ok ? cash.data : null;
  const saved = accounts.ok ? accounts.data.data : [];

  return (
    <div className="mx-auto max-w-lg space-y-5">
      <Link href="/account/crypto" className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-slate-600 hover:text-navy-900">
        <ChevronLeft className="size-4" aria-hidden="true" /> Crypto
      </Link>
      <h1 className="font-display text-2xl font-extrabold text-navy-900">Cash out{money?.mode === "test" ? " (test)" : ""}</h1>
      <CryptoNav current="/account/crypto/cash-out" />
      {!cash.ok && cash.code === "customer_verification_required" ? (
        <div className={card}>
          <p className="flex items-center gap-2 font-semibold">
            <ShieldCheck className="size-5 text-brand-500" aria-hidden="true" /> Verify your identity to cash out
          </p>
          <p className="mt-1 text-sm text-slate-600">We pay P2P money only into an account in your own name, so we need a quick identity check first, once.</p>
          <Link href="/account/verification" className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-brand-500 px-4 font-semibold text-white hover:bg-brand-600">
            Verify my identity
          </Link>
        </div>
      ) : !cash.ok ? (
        <p className={card} role="alert">
          {cash.message}
        </p>
      ) : null}
      {money ? (
        <section className={card} aria-label="Your P2P money">
          <p className="text-sm text-slate-500">P2P money you can pay out now</p>
          <p className="font-display text-3xl font-extrabold">{formatFace(money.available, money.currency)}</p>
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
          <CashOutForm
            nonce={randomUUID()}
            currency={money.currency}
            available={formatFace(money.available, money.currency)}
            accounts={saved.map(item => ({
              id: item.id,
              label: `${item.bank_name} ••••${item.account_number_last4}`,
              ready: item.ready,
              from: date(item.payouts_available_from),
            }))}
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
                  <ActionButton
                    action={removeCashOutAccount}
                    fields={{ id: item.id }}
                    label={`Remove ${item.bank_name} ending ${item.account_number_last4}`}
                    className="inline-flex size-11 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 hover:text-red-700"
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </ActionButton>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mb-3 text-sm text-slate-600">Add the bank account to pay your P2P money into. It must be in your own name.</p>
          )}
          {banks?.ok ? <CashOutAccountForm banks={banks.data.data} /> : banks ? <p className="text-sm text-red-700">{banks.message}</p> : null}
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
                    {date(item.created_at)}
                  </span>
                  {item.failure_reason ? <span className="block text-xs text-red-700">{item.failure_reason}</span> : null}
                </span>
                <span className={`shrink-0 text-sm font-semibold ${item.status === "paid" ? "text-emerald-700" : item.status === "failed" ? "text-slate-500" : "text-amber-700"}`}>{statusLabel[item.status]}</span>
                {item.mode === "test" && (item.status === "pending" || item.status === "processing") ? (
                  <span className="flex w-full gap-2">
                    {(["paid", "failed"] as const).map(outcome => (
                      <ActionButton key={outcome} action={simulateCashOut} fields={{ id: item.id, outcome }} className="inline-flex min-h-10 items-center rounded-xl px-3 text-sm font-semibold ring-1 ring-amber-300 hover:bg-amber-50">
                        Test: {outcome === "paid" ? "pay it" : "fail it"}
                      </ActionButton>
                    ))}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
