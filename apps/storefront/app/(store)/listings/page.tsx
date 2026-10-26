import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CategoryTiles, ResaleGrid, ResaleSearch } from "@/components/store/resale";
import { query } from "@/lib/api";
import { resaleCategories, resaleListings, resaleStore } from "@/lib/resale";

const pageSize = 24;
const sorts = { newest: "Newest", price_asc: "Price: low to high", price_desc: "Price: high to low" } as const;
type Sort = keyof typeof sorts;
type Params = Record<string, string | string[] | undefined>;

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

function read(params: Params) {
  const sort = one(params.sort) as Sort;
  const category = one(params.category);
  return {
    q: one(params.q).slice(0, 100),
    category: /^[a-z0-9]+(-[a-z0-9]+)*$/.test(category) ? category : "",
    sort: sort in sorts ? sort : ("newest" as Sort),
    page: Math.max(1, Math.min(200, Number.parseInt(one(params.page), 10) || 1)),
  };
}

export async function generateMetadata({ searchParams }: { searchParams: Promise<Params> }): Promise<Metadata> {
  const { q, category, sort, page } = read(await searchParams);
  // Searches, sorted and later pages are not indexed; the store's categories are.
  return { title: q ? `Search: ${q}` : "Shop everything", alternates: { canonical: `/listings${query({ category })}` }, robots: q || sort !== "newest" || page > 1 ? { index: false, follow: true } : undefined };
}

/** A Resale shop's whole range (B2B reselling): its categories, search, sort and every listing on sale. */
export default async function ListingsPage({ searchParams }: { searchParams: Promise<Params> }) {
  if (!(await resaleStore())) notFound();
  const { q, category, sort, page } = read(await searchParams);
  const [result, categories] = await Promise.all([resaleListings({ q: q || undefined, category: category || undefined, sort, offset: (page - 1) * pageSize, limit: pageSize }), resaleCategories()]);
  const items = result.ok ? result.data.data : [];
  const total = result.ok ? result.data.total : 0;
  const tiles = categories.ok ? categories.data.data : [];
  const current = tiles.find(tile => tile.slug === category);
  const link = (changes: Partial<{ category: string; sort: Sort; page: number }>) => `/listings${query({ q: q || undefined, category: changes.category ?? category, sort: (changes.sort ?? sort) === "newest" ? undefined : (changes.sort ?? sort), page: changes.page && changes.page > 1 ? changes.page : undefined })}`;
  const pages = Math.ceil(total / pageSize);

  return (
    <div className="grid gap-6">
      <header className="grid gap-3">
        <h1 className="font-display text-3xl font-extrabold tracking-tight text-navy-900 sm:text-4xl">{q ? `Results for “${q}”` : (current?.name ?? "Shop everything")}</h1>
        <ResaleSearch defaultValue={q} className="max-w-2xl" />
        {tiles.length ? (
          <nav aria-label="Categories" className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <ul className="flex gap-2">
              <li>
                <Link href={link({ category: "", page: 1 })} aria-current={!category ? "page" : undefined} className={`inline-flex min-h-10 items-center whitespace-nowrap rounded-full px-4 text-sm font-semibold ${!category ? "bg-navy-900 text-white" : "bg-white text-navy-900 ring-1 ring-slate-200"}`}>
                  All
                </Link>
              </li>
              {tiles.map(tile => (
                <li key={tile.slug}>
                  <Link
                    href={link({ category: tile.slug, page: 1 })}
                    aria-current={tile.slug === category ? "page" : undefined}
                    className={`inline-flex min-h-10 items-center whitespace-nowrap rounded-full px-4 text-sm font-semibold ${tile.slug === category ? "bg-navy-900 text-white" : "bg-white text-navy-900 ring-1 ring-slate-200"}`}
                  >
                    {tile.name} <span className="ml-1.5 text-xs opacity-70">{tile.count}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600">
          <span>{total === 1 ? "1 item" : `${total} items`}</span>
          <ul className="flex flex-wrap gap-1.5" aria-label="Sort">
            {(Object.keys(sorts) as Sort[]).map(key => (
              <li key={key}>
                <Link href={link({ sort: key, page: 1 })} aria-current={key === sort ? "true" : undefined} className={`inline-flex min-h-9 items-center rounded-lg px-3 ${key === sort ? "bg-slate-100 font-semibold text-navy-900" : "hover:bg-slate-50"}`}>
                  {sorts[key]}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </header>
      {items.length ? (
        <ResaleGrid items={items} />
      ) : (
        <div className="grid gap-3 rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <p className="font-semibold text-navy-900">{q || category ? "Nothing matches." : "Nothing on sale right now."}</p>
          {!q && !category && tiles.length === 0 ? null : (
            <Link href="/listings" className="font-semibold text-brand-600 hover:underline">
              See everything
            </Link>
          )}
        </div>
      )}
      {!q && !category && tiles.length > 1 && page === 1 ? (
        <section aria-labelledby="all-categories" className="grid gap-3">
          <h2 id="all-categories" className="font-display text-xl font-extrabold text-navy-900">
            Categories
          </h2>
          <CategoryTiles categories={tiles} />
        </section>
      ) : null}
      {pages > 1 ? (
        <nav aria-label="Pages" className="flex items-center justify-between gap-3 text-sm">
          {page > 1 ? (
            <Link href={link({ page: page - 1 })} className="rounded-xl px-4 py-2 font-semibold ring-1 ring-slate-200 hover:bg-slate-50">
              Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="text-slate-500">
            Page {page} of {pages}
          </span>
          {page < pages ? (
            <Link href={link({ page: page + 1 })} className="rounded-xl px-4 py-2 font-semibold ring-1 ring-slate-200 hover:bg-slate-50">
              Next
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </div>
  );
}
