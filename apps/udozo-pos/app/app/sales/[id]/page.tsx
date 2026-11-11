import { needs } from "@/lib/gates";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RefundSale } from "@/components/refund-sale";
import { methodLabel, money, saleTime, vatText } from "@/lib/pos";
import { ownerSale } from "@/lib/pos-data";

export const metadata: Metadata = { title: "Sale", robots: { index: false, follow: false } };

/** One sale as it was rung up: its lines, totals and how it was paid, and refunding it. */
export default async function SalePage({ params }: { params: Promise<{ id: string }> }) {
  const pos = await needs("own_sales", "all_sales");
  const view = pos.ok ? pos.data : null;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const result = await ownerSale(id);
  if (!result.ok) {
    if (result.status === 404) notFound();
    return (
      <p role="alert" className="rounded-[20px] bg-white p-6 text-pos-error">
        {result.message}
      </p>
    );
  }
  const sale = result.data;
  const at = (amount: number) => money(amount, sale.currency);
  return (
    <div className="grid gap-6">
      <div>
        <Link href="/app/sales" className="text-sm font-semibold">
          ← Sales
        </Link>
        <h1 className="mt-2 font-display text-3xl font-bold text-pos-ink">
          Sale {sale.number}
          {sale.status === "refunded" ? <span className="ml-3 rounded-full bg-pos-warn-bg px-3 py-1 align-middle text-sm text-pos-warn">Refunded</span> : null}
        </h1>
        <p className="mt-1 text-pos-ink-2">
          {saleTime(sale.created_at)} · {sale.shop.name}, {sale.till.name} · by {sale.sold_by}
        </p>
        {sale.customer ? (
          <p className="mt-1 text-pos-ink-2">
            Customer:{" "}
            <Link href={`/app/customers/${sale.customer.id}`} className="font-semibold">
              {sale.customer.name}
            </Link>
          </p>
        ) : null}
      </div>

      <section aria-labelledby="lines" className="rounded-[20px] bg-white p-5">
        <h2 id="lines" className="sr-only">
          What was sold
        </h2>
        <ul className="grid gap-2">
          {sale.lines.map(line => (
            <li key={line.listing_id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-pos-line pb-2">
              <span className="min-w-0">
                <span className="block font-semibold text-pos-ink">{line.title}</span>
                <span className="text-sm text-pos-muted">
                  {at(line.unit_price)} × {line.quantity}
                  {line.discount ? ` less ${at(line.discount)}` : ""}
                  {line.sku ? ` · ${line.sku}` : ""}
                </span>
              </span>
              <span className="font-semibold text-pos-ink">{at(line.total)}</span>
            </li>
          ))}
        </ul>
        <dl className="mt-3 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-pos-ink-2">
          <dt>Subtotal</dt>
          <dd className="text-right">{at(sale.subtotal)}</dd>
          {sale.discount ? (
            <>
              <dt>Discount</dt>
              <dd className="text-right">−{at(sale.discount)}</dd>
            </>
          ) : null}
          {sale.vat_bps ? (
            <>
              <dt>VAT {vatText(sale.vat_bps)}</dt>
              <dd className="text-right">{at(sale.vat)}</dd>
            </>
          ) : null}
          <dt className="font-display text-xl font-bold text-pos-ink">Total</dt>
          <dd className="text-right font-display text-xl font-bold text-pos-ink">{at(sale.total)}</dd>
        </dl>
      </section>

      <section aria-labelledby="paid" className="rounded-[20px] bg-white p-5">
        <h2 id="paid" className="font-display text-xl font-bold text-pos-ink">
          How it was paid
        </h2>
        <ul className="mt-2 grid gap-1">
          {sale.payments.map((payment, index) => (
            <li key={index}>
              <strong>{methodLabel(payment.method)}</strong> {at(payment.amount)}
              {payment.tendered ? <span className="text-pos-muted"> · given {at(payment.tendered)}, change {at(payment.change)}</span> : null}
              {payment.reference ? <span className="text-pos-muted"> · {payment.reference}</span> : null}
            </li>
          ))}
        </ul>
        {sale.note ? <p className="mt-2 text-pos-ink-2">Note: {sale.note}</p> : null}
      </section>

      {sale.status === "refunded" ? (
        <section className="rounded-[20px] bg-pos-warn-bg p-5 text-pos-warn">
          <p className="font-semibold">
            Refunded {sale.refunded_at ? saleTime(sale.refunded_at) : ""}
            {sale.refunded_by ? ` by ${sale.refunded_by}` : ""}: {sale.refund_reason}
          </p>
          <p className="mt-1 text-sm">{sale.restocked ? "Its items went back into stock." : "Its items were not put back into stock."}</p>
        </section>
      ) : view && view.permissions.refund !== "no" ? (
        <RefundSale id={sale.id} number={sale.number} total={at(sale.total)} approvers={view.approvers} />
      ) : null}
    </div>
  );
}
