import Link from "next/link";
import { staffLinks } from "@/components/owner-nav";
import { allows, discountText, money, salesQuery, shopToday } from "@/lib/pos";
import { currentPos, ownerSales } from "@/lib/pos-data";

/**
 * A member of staff's home: who they are signed in as, their shop, what their role lets them do, and (where they may
 * see sales) today's sales they may see. Nothing of the owner's plan, wallet or payments.
 */
export async function StaffHome() {
  const pos = await currentPos();
  if (!pos.ok) return null;
  const view = pos.data;
  const today = shopToday();
  const seesSales = allows(view.permissions, "own_sales") || allows(view.permissions, "all_sales");
  const sales = seesSales ? await ownerSales(salesQuery({ day: today }).api.replace(/limit=\d+/, "limit=1")) : null;
  const shop = view.shops[0];
  const places = staffLinks(view.permissions).filter(link => link.href !== "/app");
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="font-display text-3xl font-bold text-pos-ink">Hello, {view.name.split(" ")[0]}</h1>
        <p className="mt-1 text-pos-ink-2">
          {view.role}
          {shop ? ` at ${shop.name}` : ""}. What you do here is recorded under your name.
        </p>
      </div>

      {sales ? (
        <section aria-labelledby="today" className="rounded-[20px] bg-white p-6">
          <h2 id="today" className="font-display text-xl font-bold text-pos-ink">
            Today{view.permissions.all_sales === "yes" ? "" : ", your sales"}
          </h2>
          <p className="mt-1 text-pos-ink-2">
            {sales.ok
              ? sales.data.summary.sales
                ? `${sales.data.summary.sales} ${sales.data.summary.sales === 1 ? "sale" : "sales"}, ${money(sales.data.summary.takings, sales.data.currency)} taken.`
                : "No sales yet today."
              : "Sales could not be read just now."}
          </p>
        </section>
      ) : null}

      <section aria-labelledby="places" className="rounded-[20px] bg-white p-6">
        <h2 id="places" className="font-display text-xl font-bold text-pos-ink">
          Your work
        </h2>
        {places.length ? (
          <ul className="mt-4 flex flex-wrap gap-2">
            {places.map(link => (
              <li key={link.href}>
                <Link href={link.href} className={`inline-flex h-12 items-center rounded-xl px-5 font-bold no-underline ${link.href === "/app/till" ? "bg-pos-600 text-white hover:bg-pos-700" : "border border-pos-line text-pos-ink hover:bg-pos-50"}`}>
                  {link.href === "/app/till" ? "Open the till" : link.label}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-pos-ink-2">Your role has nothing to do here yet. Ask the shop owner.</p>
        )}
        {view.permissions.sell === "yes" ? <p className="mt-4 text-sm text-pos-muted">Discounts you may give without a manager: {discountText(view.discountLimit).toLowerCase()}.</p> : null}
      </section>
    </div>
  );
}
