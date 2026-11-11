import Link from "next/link";
import { limitText, money, salesQuery, shopToday, statusText } from "@/lib/pos";
import { currentOwner, ownerCatalogue, ownerSales } from "@/lib/pos-data";
import { udozoUrl } from "@/lib/site";

/**
 * The owner's home: today's takings with the till a tap away, their shop, where the plan stands, and what to do next.
 * Staff come in a later milestone, and say so.
 */
export default async function OwnerHome() {
  const today = shopToday();
  const [owner, catalogue, sales] = await Promise.all([currentOwner(), ownerCatalogue("?limit=1"), ownerSales(salesQuery({ day: today }).api.replace(/limit=\d+/, "limit=1"))]);
  if (!owner.ok || !owner.data.account) return null;
  const products = catalogue.ok ? catalogue.data.summary.products : 0;
  const { account, plans } = owner.data;
  const shop = account.shops[0];
  const tills = account.shops.reduce((sum, item) => sum + item.tills.length, 0);
  const warn = account.status === "past_due";
  const next = [
    { done: Boolean(shop?.address), title: "Add your shop's address", body: "It is printed on every receipt.", href: "/app/setup", action: "Shop details" },
    { done: tills > 0, title: "Name your tills", body: "One for each counter or device you sell from.", href: "/app/setup#tills", action: "Tills" },
    products > 0
      ? { done: true, title: "Tick Sell at POS on your listings", body: `${products} ${products === 1 ? "product is" : "products are"} at the till, with their stock from udozo.com.`, href: "/app/products", action: "Products" }
      : { done: false, title: "Tick Sell at POS on your listings", body: "On udozo.com, tick Sell at your shop with Udozo POS on what you sell in the shop. It comes to the till with its stock.", href: udozoUrl("/account/listings"), action: "My listings on udozo.com" },
    { done: false, title: "Invite your team", body: "Cashiers and managers sign in with a PIN. Coming soon.", href: null, action: null },
  ];
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="font-display text-3xl font-bold text-pos-ink">{shop?.name ?? "Your shop"}</h1>
        {shop ? <p className="mt-1 text-pos-ink-2">Shop code {shop.shop_code} · your staff sign in with it.</p> : null}
      </div>

      <section aria-labelledby="plan" className={`rounded-[20px] p-6 ${warn ? "bg-pos-warn-bg" : "bg-white"}`}>
        <h2 id="plan" className="font-display text-xl font-bold text-pos-ink">
          {account.plan.name}
        </h2>
        <p className={`mt-1 ${warn ? "font-semibold text-pos-warn" : "text-pos-ink-2"}`}>{statusText(account, plans)}</p>
        <p className="mt-2 text-sm text-pos-muted">
          {(["shops", "tills", "staff", "products"] as const).map(key => limitText(key, account.limits[key])).join(" · ")}
        </p>
        <Link href="/app/billing" className="mt-4 inline-flex h-11 items-center rounded-xl border border-pos-600 px-4 font-semibold text-pos-700 no-underline hover:bg-pos-50">
          Plan and billing
        </Link>
      </section>

      <section aria-labelledby="next" className="rounded-[20px] bg-white p-6">
        <h2 id="next" className="font-display text-xl font-bold text-pos-ink">
          Getting your till ready
        </h2>
        <ol className="mt-4 grid gap-3">
          {next.map(item => (
            <li key={item.title} className="flex flex-wrap items-center gap-3 rounded-2xl border border-pos-line p-4">
              <span aria-hidden="true" className={`flex size-8 shrink-0 items-center justify-center rounded-full font-bold ${item.done ? "bg-pos-600 text-white" : "bg-pos-page text-pos-muted"}`}>
                {item.done ? "✓" : "·"}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-pos-ink">
                  {item.title}
                  {item.done ? <span className="sr-only"> (done)</span> : null}
                </span>
                <span className="block text-sm text-pos-ink-2">{item.body}</span>
              </span>
              {item.href && item.action ? (
                <a href={item.href} className="text-sm font-semibold">
                  {item.action}
                </a>
              ) : null}
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="register" className="flex flex-wrap items-center gap-4 rounded-[20px] bg-white p-6">
        <div className="min-w-0 flex-1">
          <h2 id="register" className="font-display text-xl font-bold text-pos-ink">
            Today
          </h2>
          <p className="mt-1 text-pos-ink-2">
            {sales.ok
              ? sales.data.summary.sales
                ? `${sales.data.summary.sales} ${sales.data.summary.sales === 1 ? "sale" : "sales"}, ${money(sales.data.summary.takings, sales.data.currency)} taken.`
                : "No sales yet today."
              : "Your sales could not be read just now."}
          </p>
        </div>
        <Link href={`/app/sales?day=${today}`} className="font-semibold">
          Sales
        </Link>
        <Link href="/app/till" className="inline-flex h-12 items-center rounded-xl bg-pos-600 px-5 font-bold text-white no-underline hover:bg-pos-700">
          Open the till
        </Link>
      </section>
    </div>
  );
}
