"use client";

import { useDeferredValue, useState } from "react";
import Link from "next/link";
import { Search, ShoppingCart } from "lucide-react";
import { Badge, Card, categoryName, DataTable, Dialog, errorMessage, FilterSelect, formatMoney, Input, LoadMore, PageHeader } from "@bitocard/admin-ui";
import { type CatalogueCategory, catalogueCategories, type Product, useCatalogueProductsInfiniteQuery } from "@bitocard/api-client/reseller";
import { ShqShell } from "@/components/shq-shell";
import { useReseller } from "@/components/reseller";

const faceValues = (product: Product) =>
  product.denomination.type === "fixed"
    ? product.denomination.values.length > 3
      ? `${product.denomination.values.length} values`
      : product.denomination.values.map(value => formatMoney(value, product.face_currency)).join(", ")
    : `${formatMoney(product.denomination.min, product.face_currency)} – ${formatMoney(product.denomination.max, product.face_currency)}`;

const priceRange = (product: Product) => {
  const prices = product.pricing.denominations.map(item => item.price);
  if (!prices.length) return "—";
  const low = Math.min(...prices);
  const high = Math.max(...prices);
  const currency = product.pricing.currency;
  return low === high ? formatMoney(low, currency) : `${formatMoney(low, currency)} – ${formatMoney(high, currency)}`;
};

function ProductDialog({ product, onClose }: { product: Product | null; onClose: () => void }) {
  return (
    <Dialog
      open={product !== null}
      onClose={onClose}
      title={product?.name ?? ""}
      description={product ? `${categoryName(product.category)} · ${product.country} · face value in ${product.face_currency}` : undefined}
      footer={
        product ? (
          <Link href={`/orders/new?product=${product.id}`} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand-500 px-4 text-sm font-semibold text-white shadow-sm hover:bg-brand-600">
            <ShoppingCart className="size-4" aria-hidden />
            Sell this
          </Link>
        ) : null
      }
    >
      {product ? (
        <div className="space-y-4 text-sm">
          {product.description ? <p className="text-muted">{product.description}</p> : null}
          <div className="overflow-hidden rounded-xl border border-line">
            <table className="w-full text-left">
              <caption className="sr-only">Prices by face value</caption>
              <thead>
                <tr className="bg-canvas text-xs font-semibold text-muted">
                  <th scope="col" className="px-3 py-2">
                    Face value
                  </th>
                  <th scope="col" className="px-3 py-2 text-right">
                    Wholesale
                  </th>
                  <th scope="col" className="px-3 py-2 text-right">
                    Your price
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {product.pricing.denominations.map(item => (
                  <tr key={item.face_value}>
                    <td className="px-3 py-2">{formatMoney(item.face_value, product.face_currency)}</td>
                    <td className="px-3 py-2 text-right">{formatMoney(item.wholesale, product.pricing.currency)}</td>
                    <td className="px-3 py-2 text-right font-semibold">{formatMoney(item.price, product.pricing.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted">
            {product.denomination.type === "range" ? "Any amount in the range can be sold; the lowest and highest are shown. " : ""}
            Prices are before any tax added at checkout. A quote locks the exact price for 10 minutes.
          </p>
          {product.redeem_instructions ? (
            <div>
              <p className="font-semibold">How to redeem</p>
              <p className="mt-1 whitespace-pre-line text-muted">{product.redeem_instructions}</p>
            </div>
          ) : null}
        </div>
      ) : null}
    </Dialog>
  );
}

export default function CataloguePage() {
  const { membership } = useReseller();
  const [category, setCategory] = useState<"" | CatalogueCategory>("");
  const [country, setCountry] = useState("");
  const [search, setSearch] = useState("");
  const q = useDeferredValue(search.trim());
  const query = useCatalogueProductsInfiniteQuery({ category: category || undefined, country: country || undefined, q: q || undefined });
  const rows = query.data?.pages.flatMap(page => page.data);
  const [open, setOpen] = useState<Product | null>(null);

  // The API has no list of markets for resellers: offer their own country and every country seen so far.
  const countries = [...new Set([membership.reseller.country, country, ...(rows?.map(row => row.country) ?? [])].filter((value): value is string => Boolean(value)))].sort();

  return (
    <ShqShell section="catalogue" current="/catalogue" crumbs={[{ label: "Catalogue", href: "/catalogue" }, { label: "Products" }]}>
      <PageHeader title="Products" description="What you can sell, with your price for each face value. Change your markups under Pricing." />
      <div className="flex flex-wrap gap-3">
        <FilterSelect
          id="category"
          label="Category"
          value={category}
          onChange={value => setCategory(value as "" | CatalogueCategory)}
          options={[{ value: "", label: "All categories" }, ...catalogueCategories.map(value => ({ value, label: categoryName(value) }))]}
        />
        <FilterSelect id="country" label="Used in" value={country} onChange={setCountry} options={[{ value: "", label: "All countries" }, ...countries.map(value => ({ value, label: value }))]} />
        <label className="relative flex min-w-0 flex-1 basis-56 items-center">
          <span className="sr-only">Search products</span>
          <Search className="pointer-events-none absolute left-3 size-4 text-subtle" aria-hidden />
          <Input type="search" placeholder="Search by name or brand" value={search} maxLength={60} onChange={event => setSearch(event.target.value)} className="min-h-[3.75rem] pl-9" />
        </label>
      </div>
      <Card>
        <DataTable
          caption="Products"
          rows={rows}
          loading={query.isLoading}
          error={query.error ? errorMessage(query.error) : null}
          onRetry={query.refetch}
          rowKey={product => product.id}
          onRowClick={setOpen}
          empty={category || country || q ? "No products match these filters." : "No products are available to you yet."}
          columns={[
            {
              key: "product",
              header: "Product",
              cell: product => (
                <span className="block min-w-0">
                  <span className="block truncate font-semibold">{product.name}</span>
                  <span className="block text-xs font-normal text-muted">{categoryName(product.category)}</span>
                </span>
              ),
            },
            { key: "country", header: "Used in", cell: product => <Badge dot={false}>{product.country}</Badge> },
            { key: "values", header: "Face values", cell: product => <span className="text-muted">{faceValues(product)}</span>, hideOnMobile: true },
            { key: "price", header: "Your price", align: "right", cell: product => <span className="font-semibold">{priceRange(product)}</span> },
          ]}
        />
        <LoadMore hasMore={query.hasNextPage} loading={query.isFetchingNextPage} onClick={() => query.fetchNextPage()} />
      </Card>
      <ProductDialog product={open} onClose={() => setOpen(null)} />
    </ShqShell>
  );
}
