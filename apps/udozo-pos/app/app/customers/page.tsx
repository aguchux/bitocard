import type { Metadata } from "next";
import Link from "next/link";
import { customersPage, customersQuery, money, saleTime } from "@/lib/pos";
import { ownerCustomers } from "@/lib/pos-data";
import { needs } from "@/lib/gates";

export const metadata: Metadata = {
  title: "Customers",
  robots: { index: false, follow: false },
};

type Params = { q?: string; owing?: string; page?: string };

function hrefWith(
  current: ReturnType<typeof customersQuery>,
  change: Partial<{ q: string; owing: boolean; page: number }>,
) {
  const next = { q: current.q, owing: current.owing, page: 1, ...change };
  const search = new URLSearchParams();
  if (next.q) search.set("q", next.q);
  if (next.owing) search.set("owing", "1");
  if (next.page > 1) search.set("page", String(next.page));
  const text = search.toString();
  return `/app/customers${text ? `?${text}` : ""}`;
}

const chip = (on: boolean) =>
  `flex h-10 items-center rounded-full px-4 text-sm font-semibold whitespace-nowrap no-underline ${on ? "bg-pos-600 text-white" : "bg-white text-pos-ink-2 hover:bg-pos-50"}`;

/**
 * The shop's customers: its own records, needing no Udozo account. Udozo customers who paid through Udozo are added on
 * the way, linked to their account. Found by name, mobile or number; those who owe the shop first among their filter.
 */
export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const query = customersQuery(await searchParams);
  const [owner, result] = await Promise.all([
    needs("customers"),
    ownerCustomers(query.api),
  ]);
  if (!result.ok) {
    return (
      <p role="alert" className="rounded-[20px] bg-white p-6 text-pos-error">
        {result.message}
      </p>
    );
  }
  const currency = owner.ok ? owner.data.currency : "NGN";
  const list = result.data;
  const pages = Math.max(1, Math.ceil(list.total / customersPage));
  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold text-pos-ink">
            Customers
          </h1>
          <p className="mt-1 max-w-2xl text-pos-ink-2">
            Your shop&apos;s own customers: no Udozo account needed. Udozo
            customers who pay you through Udozo are added here with their Udozo
            rating.
          </p>
        </div>
        <Link
          href="/app/customers/new"
          className="inline-flex h-11 items-center rounded-xl bg-pos-600 px-5 font-bold text-white no-underline hover:bg-pos-700"
        >
          Add a customer
        </Link>
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:max-w-md">
        <div className="rounded-[18px] bg-white p-4">
          <dt className="text-sm text-pos-muted">Owe you</dt>
          <dd className="mt-1 font-display text-2xl font-bold text-pos-ink">
            {list.summary.owing}
          </dd>
        </div>
        <div
          className={`rounded-[18px] p-4 ${list.summary.owed ? "bg-pos-warn-bg" : "bg-white"}`}
        >
          <dt
            className={`text-sm ${list.summary.owed ? "text-pos-warn" : "text-pos-muted"}`}
          >
            Owed to you
          </dt>
          <dd className="mt-1 truncate font-display text-2xl font-bold text-pos-ink">
            {money(list.summary.owed, currency)}
          </dd>
        </div>
      </dl>

      <form
        role="search"
        action="/app/customers"
        className="flex flex-wrap gap-2"
      >
        <label htmlFor="customer-search" className="sr-only">
          Find a customer
        </label>
        <input
          id="customer-search"
          name="q"
          defaultValue={query.q}
          placeholder="Name, mobile, email or number"
          className="h-12 min-w-0 flex-1 rounded-xl border border-pos-line bg-white px-4 text-base"
        />
        {query.owing ? <input type="hidden" name="owing" value="1" /> : null}
        <button
          type="submit"
          className="h-12 rounded-xl bg-pos-600 px-5 font-bold text-white hover:bg-pos-700"
        >
          Find
        </button>
      </form>
      <nav aria-label="Show">
        <ul className="flex gap-2">
          <li>
            <Link
              href={hrefWith(query, { owing: false })}
              aria-current={!query.owing ? "page" : undefined}
              className={chip(!query.owing)}
            >
              Everyone
            </Link>
          </li>
          <li>
            <Link
              href={hrefWith(query, { owing: true })}
              aria-current={query.owing ? "page" : undefined}
              className={chip(query.owing)}
            >
              Owe you
            </Link>
          </li>
        </ul>
      </nav>

      {list.data.length ? (
        <ul className="grid gap-2">
          {list.data.map((customer) => (
            <li key={customer.id}>
              <Link
                href={`/app/customers/${customer.id}`}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-[16px] bg-white p-4 no-underline hover:ring-2 hover:ring-pos-600"
              >
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-pos-ink">
                    {customer.name}
                    {customer.udozo ? (
                      <span className="ml-2 rounded-full bg-pos-50 px-2 py-0.5 text-xs text-pos-700">
                        Udozo
                      </span>
                    ) : null}
                  </span>
                  <span className="block truncate text-sm text-pos-muted">
                    {[
                      customer.number,
                      customer.phone,
                      customer.sales_count
                        ? `${customer.sales_count} ${customer.sales_count === 1 ? "sale" : "sales"}`
                        : "No sales yet",
                      customer.last_sale_at
                        ? `last ${saleTime(customer.last_sale_at)}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                {customer.owed ? (
                  <span className="font-display font-bold text-pos-warn">
                    Owes {money(customer.owed, currency)}
                  </span>
                ) : (
                  <span className="text-sm text-pos-muted">
                    {money(customer.spent, currency)} spent
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-[20px] bg-white p-6 text-pos-ink-2">
          {query.q || query.owing
            ? "No customers match."
            : "No customers yet. Add one, or choose one at the till."}
        </p>
      )}

      {pages > 1 ? (
        <nav
          aria-label="Pages"
          className="flex items-center justify-between gap-3"
        >
          {query.page > 1 ? (
            <Link href={hrefWith(query, { page: query.page - 1 })}>
              Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="text-sm text-pos-muted">
            Page {query.page} of {pages}
          </span>
          {list.has_more ? (
            <Link href={hrefWith(query, { page: query.page + 1 })}>Next</Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </div>
  );
}
