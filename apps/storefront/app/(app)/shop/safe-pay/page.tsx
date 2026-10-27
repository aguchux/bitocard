import type { Metadata } from "next";
import Link from "next/link";
import { Check } from "lucide-react";
import type { ShopReadiness } from "@bitocard/api-client/classifieds";
import type { StoreCustomerBankAccount, StoreList } from "@bitocard/api-client/storefront";
import { PayoutAccountForm } from "@/components/app/shop/payout-forms";
import { ShopPills, ShopTitle } from "@/components/app/shop/shop-nav";
import { customerApi } from "@/lib/customer";
import { requireShop } from "@/lib/shop-server";

export const metadata: Metadata = { title: "Get paid with Safe pay" };

function Step({ n, done, title, note, children }: { n: number; done: boolean; title: string; note: string; children?: React.ReactNode }) {
  return (
    <section className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-start gap-3">
        <span className={`grid size-8 shrink-0 place-items-center rounded-full text-sm font-bold ${done ? "bg-emerald-700 text-white" : "border-2 border-navy-900"}`}>{done ? <Check className="size-4" aria-hidden="true" /> : n}</span>
        <span className="grid gap-0.5">
          <strong>{title}</strong>
          <span className="text-sm text-slate-600">{note}</span>
        </span>
      </div>
      {children}
    </section>
  );
}

/**
 * Getting paid through Safe pay (the design canvas's SafePaySetup board): once, before the first Safe pay sale, the
 * identity check and a payout bank account in the verified name. Selling and chatting need neither.
 */
export default async function SafePaySetup() {
  const { shop } = await requireShop("/shop/safe-pay");
  const [readiness, accounts, banks] = await Promise.all([
    customerApi<ShopReadiness>("GET", "/v1/classifieds/me/safe-pay"),
    customerApi<StoreList<StoreCustomerBankAccount>>("GET", "/v1/store/cash/bank-accounts"),
    customerApi<StoreList<{ code: string; name: string }>>("GET", "/v1/store/cash/banks"),
  ]);
  const ready = readiness.ok ? readiness.data : null;
  const saved = accounts.ok ? accounts.data.data : [];
  return (
    <div className="grid max-w-2xl gap-5">
      <ShopTitle title="Get paid with Safe pay" note="Once, before your first Safe pay sale. You can still sell and chat without it." post={false} />
      <ShopPills shop={shop} active="/shop/safe-pay" />
      {!readiness.ok ? (
        <p className="rounded-2xl bg-slate-100 p-4 text-sm text-slate-700">{readiness.code === "safe_pay_unavailable" ? readiness.message : "Your Safe pay set-up could not be read just now. Try again shortly."}</p>
      ) : null}
      {ready?.limited ? (
        <p className="rounded-2xl bg-brand-50 p-4 text-sm text-brand-700">
          You cannot take Safe pay orders right now: {ready.strikes} of {ready.strike_limit} strikes in 90 days (cancelling after accepting, missing a hand-over, or losing a dispute). Buyers can still chat with you and pay you directly.
        </p>
      ) : null}
      {ready?.ready ? <p className="rounded-2xl bg-emerald-50 p-4 text-sm font-semibold text-emerald-900">You are ready: accept Safe pay requests from Orders.</p> : null}
      {ready ? (
        <>
          <Step n={1} done={ready.identity_checked} title="Identity check" note={ready.identity_checked ? "Passed." : "A quick check of your ID, once. Your payouts go only to an account in the name it confirms."}>
            {ready.identity_checked ? null : (
              <Link href="/account/verification" className="flex h-11 items-center justify-center rounded-xl bg-navy-900 font-bold text-white hover:bg-navy-700 sm:justify-self-start sm:px-6">
                Start the identity check
              </Link>
            )}
          </Step>
          <Step n={2} done={ready.payout_account} title="Payout account" note="A bank account in your verified name. New accounts can receive payouts after 24 hours.">
            {saved.length ? (
              <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                {saved.map(account => (
                  <li key={account.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">
                        {account.bank_name} ••••{account.account_number_last4}
                      </span>
                      <span className="block truncate text-xs text-slate-500">{account.account_name}</span>
                    </span>
                    {!account.ready ? <span className="text-xs text-amber-800">Ready in 24 hours</span> : null}
                  </li>
                ))}
              </ul>
            ) : null}
            {ready.identity_checked && banks.ok ? (
              <PayoutAccountForm banks={banks.data.data} />
            ) : !ready.identity_checked ? (
              <p className="text-sm text-slate-600">Add it once your identity check has passed.</p>
            ) : (
              <p className="text-sm text-slate-600">{banks.ok ? "" : banks.message}</p>
            )}
          </Step>
          <p className="text-sm text-slate-600">
            What Safe pay sales pay you is withdrawable after the payout hold, from{" "}
            <Link href="/shop/payouts" className="font-semibold text-brand-700 hover:underline">
              Cash out
            </Link>
            .
          </p>
        </>
      ) : null}
    </div>
  );
}
