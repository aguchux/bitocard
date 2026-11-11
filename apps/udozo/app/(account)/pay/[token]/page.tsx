import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatPrice } from "@bitocard/api-client/storefront";
import { PosPay } from "@/components/account/pos-pay";
import { requireCustomer } from "@/lib/account";
import { customerApi } from "@/lib/customer";
import { type PosWalletPayment, posPayOutcome, posPayToken } from "@/lib/pos-pay";

export const metadata: Metadata = { title: "Pay a shop", robots: { index: false, follow: false }, referrer: "no-referrer" };

const card = "rounded-3xl bg-white p-5 ring-1 ring-slate-200/70";

/**
 * Paying a shop's till from the Udozo wallet: the link its QR code opens, or the notice it sent to the buyer's mobile.
 * Signed in, the buyer sees the shop, what they are buying and the amount, then pays or declines. Nothing is taken
 * until they press Pay.
 */
export default async function PosPayPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!posPayToken.test(token)) notFound();
  await requireCustomer(`/pay/${token}`);
  const result = await customerApi<PosWalletPayment>("GET", `/v1/store/account/pos-payments/${token}`);
  if (!result.ok) {
    if (result.status === 404) notFound();
    return <p className={card}>{result.message}</p>;
  }
  const payment = result.data;
  const outcome = posPayOutcome(payment);
  const atCounter = payment.total - payment.amount;
  return (
    <div className="max-w-xl space-y-5">
      <div>
        <p className="text-sm font-semibold text-slate-500">Udozo POS · {payment.number}</p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">Pay {payment.shop.name}</h1>
      </div>

      <section aria-labelledby="pay-what" className={card}>
        <h2 id="pay-what" className="font-semibold">
          What you are buying
        </h2>
        <ul className="mt-2 space-y-1 text-slate-700">
          {payment.items.map((item, index) => (
            <li key={index}>
              {item.quantity} × {item.title}
            </li>
          ))}
        </ul>
        <dl className="mt-4 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
          {atCounter > 0 ? (
            <>
              <dt className="text-slate-600">Sale total</dt>
              <dd className="text-right">{formatPrice(payment.total, payment.currency)}</dd>
              <dt className="text-slate-600">Paid at the counter</dt>
              <dd className="text-right">{formatPrice(atCounter, payment.currency)}</dd>
            </>
          ) : null}
          <dt className="text-lg font-bold">From your Udozo wallet</dt>
          <dd className="text-right text-lg font-bold">{formatPrice(payment.amount, payment.currency)}</dd>
        </dl>
      </section>

      {payment.own_shop ? (
        <p className={card}>This is your own shop: you cannot pay yourself.</p>
      ) : outcome ? (
        <p role="status" className={`${card} font-semibold ${payment.status === "paid" ? "text-emerald-700" : "text-slate-700"}`}>
          {outcome}
        </p>
      ) : (
        <>
          <PosPay token={token} payment={payment} />
          <p className="text-sm text-slate-500">Only pay at the shop, with the cashier in front of you. Udozo never asks you to pay a shop you are not at.</p>
        </>
      )}
      <Link href="/account/wallet" className="inline-flex min-h-11 items-center text-sm font-semibold text-slate-600 hover:text-navy-900">
        Your wallet
      </Link>
    </div>
  );
}
