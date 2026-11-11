import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  CustomerForm,
  RemoveCustomer,
  Repayment,
} from "@/components/customer-forms";
import { entryText, money, ratingText, saleTime } from "@/lib/pos";
import { currentOwner, ownerCustomer } from "@/lib/pos-data";

export const metadata: Metadata = {
  title: "Customer",
  robots: { index: false, follow: false },
};

/** One of the shop's customers: their details, their Udozo rating if they are on Udozo, what they owe, and their sales. */
export default async function CustomerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [owner, result] = await Promise.all([
    currentOwner(),
    ownerCustomer(id),
  ]);
  if (!result.ok) {
    if (result.status === 404) notFound();
    return (
      <p role="alert" className="rounded-[20px] bg-white p-6 text-pos-error">
        {result.message}
      </p>
    );
  }
  const customer = result.data;
  const currency = owner.ok ? owner.data.currency : "NGN";
  return (
    <div className="grid gap-6">
      <div>
        <Link href="/app/customers" className="text-sm font-semibold">
          ← Customers
        </Link>
        <h1 className="mt-2 font-display text-3xl font-bold text-pos-ink">
          {customer.name}
        </h1>
        <p className="mt-1 text-pos-ink-2">
          {customer.number} · {customer.sales_count}{" "}
          {customer.sales_count === 1 ? "sale" : "sales"} ·{" "}
          {money(customer.spent, currency)} spent
        </p>
      </div>

      {customer.udozo_rating ? (
        <section
          aria-labelledby="udozo"
          className="rounded-[20px] bg-pos-50 p-5"
        >
          <h2
            id="udozo"
            className="font-display text-xl font-bold text-pos-ink"
          >
            On Udozo
          </h2>
          <p className="mt-1 text-pos-ink-2">
            {ratingText(customer.udozo_rating)}
          </p>
          <p className="mt-1 text-xs text-pos-muted">
            Linked when they paid you through Udozo. Their Udozo account stays
            theirs; this record is your shop&apos;s.
          </p>
        </section>
      ) : null}

      <section
        aria-labelledby="owed"
        className={`grid gap-3 rounded-[20px] p-5 ${customer.owed ? "bg-pos-warn-bg" : "bg-white"}`}
      >
        <h2 id="owed" className="font-display text-xl font-bold text-pos-ink">
          {customer.owed
            ? `Owes you ${money(customer.owed, currency)}`
            : "Owes you nothing"}
        </h2>
        <p className="text-sm text-pos-ink-2">
          {customer.credit_limit != null
            ? `They may owe at most ${money(customer.credit_limit, currency)}.`
            : "No credit limit set: they may buy on credit (pay later) at the till."}
        </p>
        {customer.owed ? (
          <Repayment customer={customer} currency={currency} />
        ) : null}
        {customer.entries?.length ? (
          <ul className="grid gap-1 text-sm">
            {customer.entries.map((entry) => (
              <li
                key={entry.id}
                className="flex flex-wrap justify-between gap-2 border-b border-pos-line py-1"
              >
                <span>
                  {entryText(entry)} {money(Math.abs(entry.amount), currency)}
                  {entry.sale?.number ? ` (${entry.sale.number})` : ""}
                  {entry.reference ? ` · ${entry.reference}` : ""}
                </span>
                <span className="text-pos-muted">
                  owes {money(entry.owed_after, currency)} ·{" "}
                  {saleTime(entry.created_at)}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section aria-labelledby="sales" className="rounded-[20px] bg-white p-5">
        <h2 id="sales" className="font-display text-xl font-bold text-pos-ink">
          Sales
        </h2>
        {customer.sales?.length ? (
          <ul className="mt-2 grid gap-1">
            {customer.sales.map((sale) => (
              <li key={sale.id}>
                <Link
                  href={`/app/sales/${sale.id}`}
                  className="flex justify-between gap-3 rounded-lg px-2 py-1.5 no-underline hover:bg-pos-50"
                >
                  <span className="text-pos-ink">
                    {sale.number}
                    {sale.status === "refunded" ? " · Refunded" : ""}
                  </span>
                  <span className="text-pos-muted">
                    {money(sale.total, sale.currency)} ·{" "}
                    {saleTime(sale.created_at)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-pos-ink-2">
            No sales yet. Choose them at the till to link a sale.
          </p>
        )}
      </section>

      <section aria-labelledby="details" className="grid gap-3">
        <h2
          id="details"
          className="font-display text-xl font-bold text-pos-ink"
        >
          Details
        </h2>
        <CustomerForm customer={customer} currency={currency} />
        <RemoveCustomer customer={customer} />
      </section>
    </div>
  );
}
