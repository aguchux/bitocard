import type { Metadata } from "next";
import Link from "next/link";
import { Register } from "@/components/register";
import { ownerCatalogue, currentOwner } from "@/lib/pos-data";

export const metadata: Metadata = { title: "Till", robots: { index: false, follow: false } };

/**
 * The till: the shop's products (the shop kind's categories first), a basket, and taking payment. Every sale goes to
 * Udozo at once, so stock is right on udozo.com and every other till; selling without the internet comes later.
 */
export default async function TillPage({ searchParams }: { searchParams: Promise<{ till?: string }> }) {
  const [owner, catalogue, { till: asked }] = await Promise.all([currentOwner(), ownerCatalogue("?show=all&limit=200"), searchParams]);
  const account = owner.ok ? owner.data.account : null;
  if (!account) return null;
  const tills = account.shops.flatMap(shop => shop.tills.map(till => ({ ...till, shop })));
  const till = tills.find(item => item.id === asked) ?? tills[0];
  if (!till) {
    return (
      <section className="rounded-[20px] bg-white p-6">
        <h1 className="font-display text-2xl font-bold text-pos-ink">Add a till first</h1>
        <p className="mt-2 text-pos-ink-2">Your shop needs a till to sell from.</p>
        <Link href="/app/setup" className="mt-4 inline-flex h-12 items-center rounded-xl bg-pos-600 px-5 font-bold text-white no-underline hover:bg-pos-700">
          Shop and tills
        </Link>
      </section>
    );
  }
  if (!catalogue.ok) {
    return (
      <p role="alert" className="rounded-[20px] bg-white p-6 text-pos-error">
        {catalogue.message}
      </p>
    );
  }
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-bold text-pos-ink">
          Till <span className="text-pos-muted">· {till.shop.name}</span>
        </h1>
        {tills.length > 1 ? (
          <nav aria-label="Tills">
            <ul className="flex flex-wrap gap-2">
              {tills.map(item => (
                <li key={item.id}>
                  <Link href={`/app/till?till=${item.id}`} aria-current={item.id === till.id ? "page" : undefined} className={`flex h-10 items-center rounded-full px-4 text-sm font-semibold no-underline ${item.id === till.id ? "bg-pos-600 text-white" : "bg-white text-pos-ink-2 hover:bg-pos-50"}`}>
                    {account.shops.length > 1 ? `${item.shop.name}: ${item.name}` : item.name}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ) : (
          <span className="text-sm font-semibold text-pos-muted">{till.name}</span>
        )}
      </div>
      {catalogue.data.summary.products === 0 ? (
        <section className="rounded-[20px] bg-white p-6">
          <h2 className="font-display text-xl font-bold text-pos-ink">Nothing to sell yet</h2>
          <p className="mt-2 text-pos-ink-2">Tick Sell at your shop with Udozo POS on your listings on udozo.com, and they show here.</p>
          <Link href="/app/products" className="mt-4 inline-flex h-12 items-center rounded-xl bg-pos-600 px-5 font-bold text-white no-underline hover:bg-pos-700">
            Products
          </Link>
        </section>
      ) : (
        <Register key={till.id} tillId={till.id} vatBps={till.shop.vat_bps} currency={catalogue.data.currency} products={catalogue.data.data} categories={catalogue.data.categories} planName={catalogue.data.plan.name} />
      )}
    </div>
  );
}
