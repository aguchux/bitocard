import Link from "next/link";
import { ChevronRight, PackageCheck, ReceiptText, ShoppingBag } from "lucide-react";
import { formatPrice, type StoreCheckout, type StoreCustomerSummary, type StoreList, type StoreProduct } from "@bitocard/api-client/storefront";
import { CategoryEntry, ProductLine, SectionTitle, StatCard } from "@/components/app/blocks";
import { StatusPill } from "@/components/store/order-status";
import { storeApi } from "@/lib/api";
import { currentCustomer, customerApi } from "@/lib/customer";
import { inMarket } from "@/lib/market";
import { storeNavigation } from "@/lib/navigation";

const date = (iso: string) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(new Date(iso));

/** What the customer spent: one currency as is, several as the largest with a note. */
function spent(summary: StoreCustomerSummary | null) {
  const [first, ...rest] = summary?.orders_total ?? [];
  if (!first) return { value: "—", note: "Nothing bought yet" };
  return { value: formatPrice(first.amount, first.currency), note: rest.length ? `+ ${rest.length} other ${rest.length === 1 ? "currency" : "currencies"}` : "On delivered orders" };
}

/** Home: the customer's figures, the product groups to start from, popular products and their latest orders. */
export default async function AccountHome() {
  const [customer, summary, navigation, popular, recent] = await Promise.all([
    currentCustomer(),
    customerApi<StoreCustomerSummary>("GET", "/v1/store/account/summary"),
    storeNavigation(),
    inMarket("/v1/store/products?sort=popular&limit=8").then(path => storeApi<StoreList<StoreProduct>>(path)),
    customerApi<StoreList<StoreCheckout>>("GET", "/v1/store/checkouts?limit=3"),
  ]);
  const figures = summary.ok ? summary.data : null;
  const total = spent(figures);
  const products = popular.ok ? popular.data.data : [];
  const orders = recent.ok ? recent.data.data : [];

  return (
    <div className="space-y-8 sm:space-y-10">
      <h1 className="sr-only">Home</h1>
      <p className="text-lg text-slate-600">
        Hello, <span className="font-bold text-[#070f4c]">{customer?.name.split(" ")[0] ?? "there"}</span>
      </p>

      <section aria-label="Your figures" className="grid gap-3 md:grid-cols-3 md:gap-4">
        <StatCard icon={ShoppingBag} tone="pink" label="Orders total" value={total.value} note={total.note} />
        <StatCard icon={ReceiptText} tone="blue" label="Orders" value={String(figures?.orders.total ?? 0)} note={figures?.orders.in_progress ? `${figures.orders.in_progress} on the way` : "None on the way"} />
        <StatCard icon={PackageCheck} tone="green" label="Delivered this month" value={String(figures?.delivered_this_month ?? 0)} />
      </section>

      <section aria-labelledby="shop">
        <SectionTitle id="shop" title="Shop by category" href="/account/catalog" />
        <ul className="grid gap-3 md:grid-cols-3 md:gap-4">
          {navigation.groups.map(group => (
            <li key={group.key}>
              <CategoryEntry group={group} />
            </li>
          ))}
        </ul>
      </section>

      {products.length ? (
        <section aria-labelledby="popular">
          <SectionTitle id="popular" title="Popular now" href="/account/catalog" />
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {products.map(product => (
              <li key={product.id}>
                <ProductLine product={product} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="recent">
        <SectionTitle id="recent" title="Recent orders" href={orders.length ? "/account/orders" : undefined} />
        {orders.length ? (
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-3xl bg-white ring-1 ring-slate-100">
            {orders.map(order => (
              <li key={order.id}>
                <Link href={`/account/orders/${order.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{order.product.name}</span>
                    <span className="block text-sm text-slate-500">
                      {date(order.created_at)} · {formatPrice(order.amount, order.currency)}
                    </span>
                  </span>
                  <StatusPill status={order.status} />
                  <ChevronRight className="size-4 shrink-0 text-slate-400" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-3xl bg-white p-5 text-slate-600 ring-1 ring-slate-100">
            Your orders show here.{" "}
            <Link href="/account/catalog" className="font-semibold text-[#2477ff] hover:underline">
              Find something to buy
            </Link>
          </p>
        )}
      </section>
    </div>
  );
}
