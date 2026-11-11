import type { Metadata } from "next";
import Link from "next/link";
import { Register } from "@/components/register";
import { needs } from "@/lib/gates";
import { ownerCollections, tillCatalogue } from "@/lib/pos-data";

export const metadata: Metadata = { title: "Till", robots: { index: false, follow: false } };

/**
 * The till: the shop's products (the shop kind's categories first), a basket, and taking payment. Every sale goes to
 * Udozo at once, so stock is right on udozo.com and every other till; selling without the internet comes later.
 */
export default async function TillPage({ searchParams }: { searchParams: Promise<{ till?: string }> }) {
  const [pos, catalogue, { till: asked }] = await Promise.all([needs("sell"), tillCatalogue(), searchParams]);
  if (!pos.ok) return null;
  const view = pos.data;
  // Staff see only the tills they may use; on a linked device, only its own.
  const tills = view.shops.flatMap(shop => shop.tills.map(till => ({ ...till, shop }))).filter(till => !view.tillId || till.id === view.tillId);
  const till = tills.find(item => item.id === asked) ?? tills[0];
  // Buyers may transfer to the till's own Udozo account, once it has one (the open accounts are read only where collections are).
  let transferAccount = false;
  if (till && view.collections) {
    if (view.actor === "staff") transferAccount = view.transferTills.includes(till.id);
    else {
      const collections = await ownerCollections();
      transferAccount = collections.ok && collections.data.tills.some(item => item.id === till.id && item.collection_account?.status === "active");
    }
  }
  if (!till) {
    return (
      <section className="rounded-[20px] bg-white p-6">
        <h1 className="font-display text-2xl font-bold text-pos-ink">{view.actor === "owner" ? "Add a till first" : "No till to sell at"}</h1>
        <p className="mt-2 text-pos-ink-2">{view.actor === "owner" ? "Your shop needs a till to sell from." : "Ask the shop owner to let you use a till."}</p>
        {view.actor === "owner" ? (
          <Link href="/app/setup" className="mt-4 inline-flex h-12 items-center rounded-xl bg-pos-600 px-5 font-bold text-white no-underline hover:bg-pos-700">
            Shop and tills
          </Link>
        ) : null}
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
                    {view.shops.length > 1 ? `${item.shop.name}: ${item.name}` : item.name}
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
        <Register key={till.id} tillId={till.id} vatBps={till.shop.vat_bps} currency={catalogue.data.currency} products={catalogue.data.data} categories={catalogue.data.categories} planName={catalogue.data.plan.name} walletPayments={view.walletPayments} transferAccount={transferAccount} approvers={view.approvers} autoPrint={till.auto_print} />
      )}
    </div>
  );
}
