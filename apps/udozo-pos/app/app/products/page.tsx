/* eslint-disable @next/next/no-img-element -- listing photos come from udozo.com's own image addresses. */
import type { Metadata } from "next";
import Link from "next/link";
import { blockText, type CatalogueView, catalogueQuery, catalogueViews, cataloguePage, money, type PosProduct, stockLine } from "@/lib/pos";
import { ownerCatalogue } from "@/lib/pos-data";
import { udozoUrl } from "@/lib/site";

export const metadata: Metadata = { title: "Products", robots: { index: false, follow: false } };

type Params = { q?: string; show?: string; category?: string; page?: string };

/** The page's address with some filters changed (an empty value drops it; any change starts at page 1). */
function hrefWith(current: ReturnType<typeof catalogueQuery>, change: Partial<{ q: string; show: CatalogueView; category: string; page: number }>) {
  const next = { q: current.q, show: current.show, category: current.category, page: 1, ...change };
  const search = new URLSearchParams();
  if (next.q) search.set("q", next.q);
  if (next.show !== "all") search.set("show", next.show);
  if (next.category) search.set("category", next.category);
  if (next.page > 1) search.set("page", String(next.page));
  const text = search.toString();
  return `/app/products${text ? `?${text}` : ""}`;
}

const chip = (on: boolean) => `flex h-10 items-center rounded-full px-4 text-sm font-semibold whitespace-nowrap no-underline ${on ? "bg-pos-600 text-white" : "bg-white text-pos-ink-2 hover:bg-pos-50"}`;

/**
 * Products at the till: the owner's udozo.com listings ticked Sell at POS, read live, with what the till can sell,
 * what is low or out of stock, and why the rest cannot sell. Everything is changed on udozo.com, where the listing is.
 */
export default async function ProductsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const query = catalogueQuery(await searchParams);
  const result = await ownerCatalogue(query.api);
  if (!result.ok) {
    return (
      <p role="alert" className="rounded-[20px] bg-white p-6 text-pos-error">
        {result.message}
      </p>
    );
  }
  const catalogue = result.data;
  const { summary } = catalogue;
  const pages = Math.max(1, Math.ceil(catalogue.total / cataloguePage));
  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold text-pos-ink">Products</h1>
          <p className="mt-1 max-w-2xl text-pos-ink-2">Your udozo.com listings ticked Sell at POS. Prices, photos, stock and barcodes are your listings&apos; own, so change them on udozo.com and the till follows.</p>
        </div>
        <a href={udozoUrl("/account/listings")} target="_blank" rel="noopener" className="inline-flex h-11 items-center rounded-xl border border-pos-600 px-4 font-semibold text-pos-700 no-underline hover:bg-pos-50">
          My listings on udozo.com
        </a>
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Figure label="At the till" value={summary.limit === null ? `${summary.products}` : `${summary.products} of ${summary.limit}`} />
        <Figure label="Selling now" value={`${summary.sellable}`} />
        <Figure label="Low stock" value={`${summary.low_stock}`} tone={summary.low_stock ? "warn" : undefined} />
        <Figure label="Out of stock" value={`${summary.out_of_stock}`} tone={summary.out_of_stock ? "warn" : undefined} />
      </dl>

      {summary.over_limit > 0 ? (
        <p role="status" className="rounded-[20px] bg-pos-warn-bg p-5 font-semibold text-pos-warn">
          {catalogue.plan.name} sells {summary.limit} products at your shop, so {summary.over_limit} {summary.over_limit === 1 ? "is" : "are"} not selling.{" "}
          <Link href="/app/billing" className="underline">
            Choose a bigger plan
          </Link>{" "}
          or untick Sell at POS on listings you do not need.
        </p>
      ) : null}

      {summary.products === 0 ? (
        <section aria-labelledby="none" className="rounded-[20px] bg-white p-6">
          <h2 id="none" className="font-display text-xl font-bold text-pos-ink">
            No products at the till yet
          </h2>
          <p className="mt-2 max-w-2xl text-pos-ink-2">
            On udozo.com, open a listing, go to <strong>Where to sell</strong> and tick <strong>Sell at your shop with Udozo POS</strong>. Add its barcode there too. Things you sell only in the shop can be listed at the shop only, and never show on Udozo.
          </p>
          <a href={udozoUrl("/account/listings")} target="_blank" rel="noopener" className="mt-4 inline-flex h-12 items-center rounded-xl bg-pos-600 px-5 font-bold text-white no-underline hover:bg-pos-700">
            Open My listings on udozo.com
          </a>
        </section>
      ) : (
        <>
          <form role="search" action="/app/products" className="flex flex-wrap gap-2">
            <label htmlFor="product-search" className="sr-only">
              Find a product
            </label>
            <input id="product-search" name="q" defaultValue={query.q} placeholder="Name, SKU, barcode or listing number" className="h-12 min-w-0 flex-1 rounded-xl border border-pos-line bg-white px-4 text-base" />
            {query.show !== "all" ? <input type="hidden" name="show" value={query.show} /> : null}
            {query.category ? <input type="hidden" name="category" value={query.category} /> : null}
            <button type="submit" className="h-12 rounded-xl bg-pos-600 px-5 font-bold text-white hover:bg-pos-700">
              Find
            </button>
          </form>

          <nav aria-label="Show" className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0">
            <ul className="flex gap-2">
              {catalogueViews.map(view => (
                <li key={view.value}>
                  <Link href={hrefWith(query, { show: view.value })} aria-current={query.show === view.value ? "page" : undefined} className={chip(query.show === view.value)}>
                    {view.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          {catalogue.categories.length > 1 ? (
            <nav aria-label="Categories" className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0">
              <ul className="flex gap-2">
                <li>
                  <Link href={hrefWith(query, { category: "" })} aria-current={!query.category ? "page" : undefined} className={chip(!query.category)}>
                    Every category
                  </Link>
                </li>
                {catalogue.categories.map(category => (
                  <li key={category.id}>
                    <Link href={hrefWith(query, { category: category.id })} aria-current={query.category === category.id ? "page" : undefined} className={chip(query.category === category.id)}>
                      {category.name} <span className="ml-1 opacity-70">{category.count}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ) : null}

          {catalogue.data.length ? (
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {catalogue.data.map(product => (
                <ProductCard key={product.id} product={product} planName={catalogue.plan.name} />
              ))}
            </ul>
          ) : (
            <p className="rounded-[20px] bg-white p-6 text-pos-ink-2">No products match. Try other words, or show All.</p>
          )}

          {pages > 1 ? (
            <nav aria-label="Pages" className="flex items-center justify-between gap-3">
              {query.page > 1 ? (
                <Link href={hrefWith(query, { page: query.page - 1 })} className="font-semibold">
                  Previous
                </Link>
              ) : (
                <span />
              )}
              <span className="text-sm text-pos-muted">
                Page {query.page} of {pages}
              </span>
              {catalogue.has_more ? (
                <Link href={hrefWith(query, { page: query.page + 1 })} className="font-semibold">
                  Next
                </Link>
              ) : (
                <span />
              )}
            </nav>
          ) : null}
        </>
      )}
    </div>
  );
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: "warn" }) {
  return (
    <div className={`rounded-[18px] p-4 ${tone === "warn" ? "bg-pos-warn-bg" : "bg-white"}`}>
      <dt className={`text-sm ${tone === "warn" ? "text-pos-warn" : "text-pos-muted"}`}>{label}</dt>
      <dd className="mt-1 font-display text-2xl font-bold text-pos-ink">{value}</dd>
    </div>
  );
}

function ProductCard({ product, planName }: { product: PosProduct; planName: string }) {
  const why = blockText(product, planName);
  const price = product.price.amount === null ? "No price" : `${money(product.price.amount, product.price.currency)}${product.price.kind === "negotiable" ? ", negotiable" : ""}`;
  return (
    <li className="flex min-w-0 gap-3 rounded-[18px] bg-white p-3">
      <span className="size-20 shrink-0 overflow-hidden rounded-xl bg-pos-page">{product.photo_url ? <img src={product.photo_url} alt="" width={80} height={80} loading="lazy" className="size-20 object-cover" /> : null}</span>
      <span className="grid min-w-0 flex-1 content-start gap-1">
        <span className="truncate font-semibold text-pos-ink">{product.title ?? "Untitled draft"}</span>
        <span className="font-display text-lg font-bold text-pos-ink">{price}</span>
        <span className="text-sm text-pos-ink-2">{stockLine(product)}</span>
        <span className="flex flex-wrap gap-1.5 text-xs font-semibold">
          {product.blocked === null ? <span className="rounded-full bg-pos-50 px-2 py-0.5 text-pos-700">Selling</span> : null}
          {product.low_stock ? <span className="rounded-full bg-pos-warn-bg px-2 py-0.5 text-pos-warn">Low stock</span> : null}
          {!product.on_udozo ? <span className="rounded-full bg-pos-page px-2 py-0.5 text-pos-ink-2">Shop only</span> : null}
        </span>
        <span className="truncate text-xs text-pos-muted">
          {[product.sku, product.barcode ? `Barcode ${product.barcode}` : "No barcode", product.category?.name].filter(Boolean).join(" · ")}
        </span>
        {why ? <span className="text-sm text-pos-warn">{why}</span> : null}
        <a href={product.edit_url} target="_blank" rel="noopener" className="text-sm font-semibold">
          Edit on udozo.com
          <span className="sr-only"> ({product.title ?? "draft"})</span>
        </a>
      </span>
    </li>
  );
}

