import type { Metadata } from "next";
import { cardClass, tradeDate } from "@afrippa/ui/trade-views";
import { AccountShell } from "@/components/account-shell";
import { AddPaymentMethodForm, RemovePaymentMethod } from "@/components/payment-methods";
import { requireCustomer } from "@/lib/account";
import { customerApi } from "@/lib/customer";
import { kindNames, type PaymentMethod } from "@/lib/orders-types";

export const metadata: Metadata = { title: "Payment methods", robots: { index: false, follow: false } };

/** The currencies named services pay in, beside the trader's own. */
const extraCurrencies = ["USD", "EUR", "GBP"];

/**
 * Where the trader is paid directly by buyers (and pays from, buying): their own accounts, at most 10, each usable 24
 * hours after it is added. Lists show only the label and the last digits; the details appear only in an open order.
 */
export default async function PaymentMethodsPage() {
  const trader = await requireCustomer("/payment-methods");
  const result = await customerApi<{ data: PaymentMethod[] }>("GET", "/v1/afrippa/p2p/payment-methods");
  const methods = result.ok ? result.data.data : [];
  const currencies = [...new Set([trader.currency ?? "USD", ...extraCurrencies])];
  return (
    <AccountShell title="Payment methods" current="/payment-methods">
      <p className="text-sm text-slate-600">
        Buyers pay you directly into these accounts, and you pay sellers from them. Afrippa holds only the coins, in escrow, until the seller confirms the money arrived.
      </p>
      {!result.ok ? (
        <p className={cardClass}>{result.message}</p>
      ) : methods.length ? (
        <ul className="space-y-3" aria-label="Your payment methods">
          {methods.map(method => (
            <li key={method.id} className={`${cardClass} flex flex-wrap items-start justify-between gap-3`}>
              <div className="min-w-0">
                <p className="font-semibold">
                  {method.label} <span className="text-slate-500">{method.hint}</span>
                </p>
                <p className="text-sm text-slate-500">
                  {kindNames[method.kind]} · {method.currency} · {method.holder_name}
                </p>
                <p className={`mt-1 text-xs font-semibold ${method.usable ? "text-emerald-700" : "text-amber-700"}`}>{method.usable ? "Ready to use" : `Usable from ${tradeDate(method.usable_from)}`}</p>
                {method.reversible ? <p className="mt-1 text-xs text-amber-700">Payments through it can be taken back by the payer after you release. Sellers are warned.</p> : null}
              </div>
              <RemovePaymentMethod id={method.id} label={`${method.label} ${method.hint}`} />
            </li>
          ))}
        </ul>
      ) : (
        <p className={cardClass}>You have no payment methods yet. Add one before posting an ad or opening an order.</p>
      )}
      <section className={`${cardClass} space-y-4`} aria-labelledby="add-method">
        <h2 id="add-method" className="font-display text-lg font-extrabold">
          Add a payment method
        </h2>
        <AddPaymentMethodForm currencies={currencies} nonce={crypto.randomUUID()} method={trader.two_step.method} />
      </section>
    </AccountShell>
  );
}
