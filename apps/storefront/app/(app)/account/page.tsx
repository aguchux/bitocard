import Link from "next/link";
import { ChevronRight, PackageCheck, ReceiptText, ShoppingBag, Wallet } from "lucide-react";
import { formatPrice, type StoreCheckout, type StoreCustomerSummary, type StoreList, type StoreProduct } from "@bitocard/api-client/storefront";
import { CategoryEntry, ProductLine, SectionTitle, StatCard } from "@/components/app/blocks";
import { StatsSlider } from "@/components/app/stats-slider";
import { StatusPill } from "@/components/store/order-status";
import { storeApi } from "@/lib/api";
import { customerApi } from "@/lib/customer";
import { inMarket } from "@/lib/market";
import { storeNavigation } from "@/lib/navigation";
import { walletFor } from "@/lib/wallet";

const date = (iso: string) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(new Date(iso));

/** A figure with the currency's own symbol (₦31,363.50), short enough for a stat card; the code where there is none. */
function amount(minor: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency, currencyDisplay: "narrowSymbol", minimumFractionDigits: minor % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 }).format(minor / 100);
  } catch {
    return formatPrice(minor, currency);
  }
}

/** What the customer spent: one currency as is, several as the largest with a note. */
function spent(summary: StoreCustomerSummary | null) {
  const [first, ...rest] = summary?.orders_total ?? [];
  if (!first) return { value: "—", note: "Nothing bought yet" };
  return { value: amount(first.amount, first.currency), note: rest.length ? `+ ${rest.length} other ${rest.length === 1 ? "currency" : "currencies"}` : "On delivered orders" };
}

/** Home: the customer's figures, the product groups to start from, popular products and their latest orders. */
export default async function AccountHome() {
  const [navigation, summary, popular, recent, wallet] = await Promise.all([
    storeNavigation(),
    customerApi<StoreCustomerSummary>("GET", "/v1/store/account/summary"),
    inMarket("/v1/store/products?sort=popular&limit=8").then(path => storeApi<StoreList<StoreProduct>>(path)),
    customerApi<StoreList<StoreCheckout>>("GET", "/v1/store/checkouts?limit=3"),
    walletFor(),
  ]);
  const figures = summary.ok ? summary.data : null;
  // Card widths: the next one peeks at every width; on desktops three and a quarter show (exactly three without a wallet).
  const statItem = wallet
    ? "w-[82%] shrink-0 snap-start sm:w-[60%] md:w-[calc((100%-1rem)/2.25)] lg:w-[calc((100%-3rem)/3.25)]"
    : "w-[82%] shrink-0 snap-start sm:w-[60%] md:w-[calc((100%-1rem)/2.25)] lg:w-[calc((100%-2rem)/3)]";
  const total = spent(figures);
  const products = popular.ok ? popular.data.data : [];
  const orders = recent.ok ? recent.data.data : [];

  return (
    <div className="space-y-8 sm:space-y-10">
      <h1 className="sr-only">Home</h1>

      {/* A sideways slider at every width with the next card peeking: one on phones, two on tablets, three on desktops
          (with arrows). Without a wallet the three figures fit across a desktop exactly. */}
      <section aria-label="Your figures">
        <StatsSlider>
          {wallet ? (
            <li className={statItem}>
              <Link href="/account/wallet" className="block h-full rounded-3xl">
                <StatCard icon={Wallet} tone="navy" label="Wallet balance" value={amount(wallet.balance, wallet.currency)} note={`${wallet.mode === "test" ? "Test money · " : ""}${wallet.enabled ? "Add funds" : "Spend what is left"}`} />
              </Link>
            </li>
          ) : null}
          <li className={statItem}>
            <StatCard icon={ShoppingBag} tone="pink" label="Orders total" value={total.value} note={total.note} />
          </li>
          <li className={statItem}>
            <StatCard icon={ReceiptText} tone="blue" label="Orders" value={String(figures?.orders.total ?? 0)} note={figures?.orders.in_progress ? `${figures.orders.in_progress} on the way` : "None on the way"} />
          </li>
          <li className={statItem}>
            <StatCard icon={PackageCheck} tone="green" label="Delivered this month" value={String(figures?.delivered_this_month ?? 0)} />
          </li>
        </StatsSlider>
      </section>

      <section aria-labelledby="shop">
        <SectionTitle id="shop" title="Shop by category" href="/account/catalog" />
        <ul className="grid gap-3 md:grid-cols-3 md:gap-4">
          {[...navigation.groups].sort((a, b) => Number(b.on_sale) - Number(a.on_sale)).map(group => (
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
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-3xl bg-white ring-1 ring-slate-200/70">
            {orders.map(order => (
              <li key={order.id}>
                <Link href={`/account/orders/${order.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{order.product.name}</span>
                    <span className="block text-sm text-slate-500">
                      {date(order.created_at)} · {amount(order.amount, order.currency)}
                    </span>
                  </span>
                  <StatusPill status={order.status} />
                  <ChevronRight className="size-4 shrink-0 text-slate-400" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-3xl bg-white p-5 text-slate-600 ring-1 ring-slate-200/70">
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
