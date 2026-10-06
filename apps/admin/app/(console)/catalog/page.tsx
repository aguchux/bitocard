"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, Database, Globe2, Package, Search, Store } from "lucide-react";
import { ActionDialog, Badge, Button, Card, categoryName, DataTable, Dialog, errorMessage, FilterSelect, formatBps, formatRelative, ImageField, Input, LoadMore, Notice, PageHeader, StatCard, StatusBadge, Toggle, useDebouncedValue } from "@bitocard/admin-ui";
import { AdminShell, can, useAdmin } from "@bitocard/admin-ui/shell";
import {
  type AdminProduct,
  productCategories,
  type ProductCategory,
  type SupplierOffer,
  useCountriesQuery,
  useProductsInfiniteQuery,
  useSetProductListingMutation,
  useSuppliersQuery,
  useUpdateOfferMutation,
  useUpdateProductMutation,
} from "@bitocard/api-client/admin";
import { healthOf, SupplierHealth } from "./supplier-health";

/** The product's own image, shown on storefronts instead of the supplier's logo. */
function ProductImage({ product, editable }: { product: AdminProduct; editable: boolean }) {
  const [update, state] = useUpdateProductMutation();
  const [image, setImage] = useState(product.image_url ?? "");
  const changed = image.trim() !== (product.image_url ?? "");
  return (
    <div className="space-y-3 rounded-xl border border-line p-4">
      <ImageField
        label="Product image"
        realm="admin"
        purpose="product_image"
        targetId={product.key}
        value={image}
        onChange={setImage}
        disabled={!editable}
        hint={product.logo_url ? "Replaces the supplier's logo on storefronts. Remove it to go back to the supplier's." : "Shown on storefronts."}
      />
      <div className="flex flex-wrap items-center justify-end gap-2">
        {state.error ? <span className="mr-auto text-sm text-red-700">{errorMessage(state.error)}</span> : null}
        <Button size="sm" disabled={!editable || !changed || (image.trim() !== "" && !image.trim().startsWith("https://"))} loading={state.isLoading} onClick={() => update({ id: product.id, image_url: image.trim() || null })}>
          Save image
        </Button>
      </div>
    </div>
  );
}

function OfferRow({ offer, editable }: { offer: SupplierOffer; editable: boolean }) {
  const [update, state] = useUpdateOfferMutation();
  const [discount, setDiscount] = useState(String(offer.discount_bps));
  const [priority, setPriority] = useState(String(offer.priority));
  const changed = discount !== String(offer.discount_bps) || priority !== String(offer.priority);
  return (
    <li className="space-y-3 rounded-xl border border-line p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold">
          {offer.supplier} <span className="font-mono text-xs text-muted">{offer.sku}</span>
        </p>
        <span className="flex items-center gap-2 text-sm">
          Available
          <Toggle label={`${offer.supplier} available`} checked={offer.available} disabled={!editable} onChange={available => update({ id: offer.id, available })} />
        </span>
      </div>
      <p className="text-xs text-muted">{`Cost ${offer.cost_currency} × ${offer.cost_ratio}${offer.cost_fee_minor ? ` + ${offer.cost_fee_minor} fee` : ""} · synced ${formatRelative(offer.synced_at)}`}</p>
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <label className="text-sm">
          <span className="mb-1 block font-medium">Agreed discount (basis points)</span>
          <Input type="number" min={0} max={5000} value={discount} disabled={!editable} onChange={event => setDiscount(event.target.value)} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">Priority</span>
          <Input type="number" min={0} max={1000} value={priority} disabled={!editable} onChange={event => setPriority(event.target.value)} />
        </label>
        <Button size="sm" disabled={!editable || !changed} loading={state.isLoading} onClick={() => update({ id: offer.id, discount_bps: Number(discount), priority: Number(priority) })}>
          Save
        </Button>
      </div>
      {state.error ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
    </li>
  );
}

/** Lists or unlists one product on bitocard.com, from its row (without opening the product). */
function ListingButton({ product, editable }: { product: AdminProduct; editable: boolean }) {
  const [update, state] = useUpdateProductMutation();
  // The button flips at once (optimistic); if the API refuses, it flips back and says so.
  return (
    <span className="inline-flex items-center gap-2">
      <Button
        size="sm"
        variant={product.listed ? "secondary" : "primary"}
        disabled={!editable}
        onClick={event => {
          event.stopPropagation();
          void update({ id: product.id, listed: !product.listed });
        }}
        aria-label={`${product.listed ? "Unlist" : "List"} ${product.name} on bitocard.com`}
      >
        {product.listed ? "Unlist" : "List"}
      </Button>
      {state.isError ? (
        <span role="alert" className="text-xs text-red-700" title={errorMessage(state.error)}>
          Not saved
        </span>
      ) : null}
    </span>
  );
}

type Listing = "" | "listed" | "unlisted";

export default function ProductsPage() {
  // useSearchParams needs a Suspense boundary (a supplier's card links here with ?supplier=<code>).
  return (
    <Suspense>
      <Products />
    </Suspense>
  );
}

function Products() {
  const admin = useAdmin();
  const linkedSupplier = useSearchParams().get("supplier") ?? "";
  const [country, setCountry] = useState("");
  const [category, setCategory] = useState<"" | ProductCategory>("");
  const [supplier, setSupplier] = useState(linkedSupplier);
  const [listing, setListing] = useState<Listing>("");
  const [search, setSearch] = useState("");
  const q = useDebouncedValue(search.trim());
  const [open, setOpen] = useState<AdminProduct | null>(null);
  const [bulk, setBulk] = useState<"list" | "unlist" | null>(null);
  const [setProductListing] = useSetProductListingMutation();
  const filter = {
    country: country || undefined,
    category: category || undefined,
    supplier: supplier || undefined,
    listed: listing === "" ? undefined : listing === "listed",
    q: q.length >= 2 ? q : undefined,
  };
  const products = useProductsInfiniteQuery(filter);
  const total = products.data?.pages[0]?.total ?? 0;
  const listedCount = products.data?.pages[0]?.listed ?? 0;
  const suppliers = useSuppliersQuery();
  const countries = useCountriesQuery();
  const [updateProduct, productState] = useUpdateProductMutation();
  const rows = products.data?.pages.flatMap(page => page.data);
  const operator = can(admin, "operations");
  const offerEditor = can(admin, "operations", "finance");
  const current = open ? (rows?.find(row => row.id === open.id) ?? open) : null;

  const enabledSuppliers = suppliers.data?.data.filter(supplier => supplier.enabled) ?? [];
  const problems = suppliers.data?.data.filter(supplier => healthOf(supplier) === "degraded").length ?? 0;

  return (
    <AdminShell section="catalog" current="/catalog" crumbs={[{ label: "Catalog", href: "/catalog" }, { label: "Products" }]}>
      <PageHeader title="Product catalog" description="Products, the supplier offers behind them, and where they are sold. Suppliers sync their offers daily." />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Products loaded" icon={<Package />} tone="pink" loading={products.isLoading} value={`${rows?.length ?? 0}${products.hasNextPage ? "+" : ""}`} />
        <StatCard label="Markets" icon={<Globe2 />} tone="blue" loading={countries.isLoading} value={countries.data?.data.length ?? 0} />
        <StatCard label="Suppliers switched on" icon={<Database />} tone="violet" loading={suppliers.isLoading} value={enabledSuppliers.length} />
        <StatCard label="Suppliers needing attention" icon={<AlertTriangle />} tone="amber" loading={suppliers.isLoading} value={problems} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap gap-3">
            <FilterSelect
              id="country"
              label="Country"
              value={country}
              onChange={setCountry}
              options={[{ value: "", label: "All markets" }, ...(countries.data?.data.map(item => ({ value: item.code, label: item.name })) ?? [])]}
            />
            <FilterSelect
              id="category"
              label="Category"
              value={category}
              onChange={value => setCategory(value as "" | ProductCategory)}
              options={[{ value: "", label: "All categories" }, ...productCategories.map(value => ({ value, label: categoryName(value) }))]}
            />
            <FilterSelect
              id="supplier"
              label="Supplier"
              value={supplier}
              onChange={setSupplier}
              options={[{ value: "", label: "All suppliers" }, { value: "stock", label: "BitoCard stock" }, ...(suppliers.data?.data.map(item => ({ value: item.code, label: item.name })) ?? [])]}
            />
            <FilterSelect
              id="listing"
              label="On bitocard.com"
              value={listing}
              onChange={value => setListing(value as Listing)}
              options={[
                { value: "", label: "Listed or not" },
                { value: "listed", label: "Listed" },
                { value: "unlisted", label: "Not listed" },
              ]}
            />
            <label className="relative flex min-w-56 flex-1 items-center">
              <span className="sr-only">Search products</span>
              <Search className="pointer-events-none absolute left-4 size-4 text-subtle" aria-hidden />
              <Input type="search" placeholder="Search products…" value={search} onChange={event => setSearch(event.target.value)} className="min-h-[3.75rem] rounded-2xl pl-11" />
            </label>
          </div>
          {productState.error ? <Notice tone="red">{errorMessage(productState.error)}</Notice> : null}
          {/* bitocard.com shows only listed products; resellers list for their own stores. */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-white px-4 py-3">
            <p className="flex items-center gap-2 text-sm">
              <Store className="size-4 text-brand-600" aria-hidden />
              {products.isLoading ? (
                "Counting…"
              ) : (
                <span>
                  <span className="font-semibold">{total.toLocaleString("en-GB")}</span> {total === 1 ? "product" : "products"} ·{" "}
                  <span className="font-semibold">{listedCount.toLocaleString("en-GB")}</span> listed on bitocard.com
                </span>
              )}
            </p>
            {operator ? (
              <span className="flex flex-wrap gap-2">
                <Button size="sm" disabled={total === 0 || listedCount === total} onClick={() => setBulk("list")}>
                  {`List all ${(total - listedCount).toLocaleString("en-GB")}`}
                </Button>
                <Button size="sm" variant="secondary" disabled={listedCount === 0} onClick={() => setBulk("unlist")}>
                  {`Unlist all ${listedCount.toLocaleString("en-GB")}`}
                </Button>
              </span>
            ) : null}
          </div>
          <Card>
            <DataTable
              caption="Products"
              rows={rows}
              loading={products.isLoading}
              error={products.error ? errorMessage(products.error) : null}
              onRetry={products.refetch}
              rowKey={product => product.id}
              onRowClick={setOpen}
              empty="No products match. Sync a supplier to load its catalogue."
              columns={[
                {
                  key: "product",
                  header: "Product",
                  cell: product => (
                    <span className="flex min-w-0 items-center gap-3">
                      {product.image_url || product.card_url || product.logo_url ? (
                        // eslint-disable-next-line @next/next/no-img-element -- uploaded files and supplier logos on outside hosts
                        <img src={(product.image_url ?? product.card_url ?? product.logo_url)!} alt="" className="h-9 w-14 shrink-0 rounded-md border border-line bg-white object-contain" loading="lazy" />
                      ) : null}
                      <span className="min-w-0">
                        <span className="font-semibold">{product.name}</span>
                        <span className="block font-mono text-xs text-muted">{product.key}</span>
                      </span>
                    </span>
                  ),
                },
                { key: "category", header: "Category", cell: product => categoryName(product.category), hideOnMobile: true },
                { key: "market", header: "Market", cell: product => <Badge dot={false}>{product.country}</Badge> },
                {
                  key: "offers",
                  header: "Supplier offers",
                  cell: product => {
                    const available = product.offers.filter(offer => offer.available);
                    return available.length ? (
                      <span className="text-sm">{available.map(offer => `${offer.supplier}${offer.discount_bps ? ` (${formatBps(offer.discount_bps)})` : ""}`).join(", ")}</span>
                    ) : (
                      <StatusBadge status="in_review" label="No offer" />
                    );
                  },
                },
                { key: "status", header: "Status", cell: product => <StatusBadge status={product.active ? "active" : "disabled"} label={product.active ? "Active" : "Hidden"} /> },
                {
                  key: "store",
                  header: "bitocard.com",
                  cell: product => (
                    <span className="flex flex-col items-start gap-1">
                      {product.listed ? <Badge tone="green" dot={false}>Listed</Badge> : null}
                      <ListingButton product={product} editable={operator} />
                    </span>
                  ),
                },
              ]}
            />
            <LoadMore hasMore={products.hasNextPage} loading={products.isFetchingNextPage} onClick={() => products.fetchNextPage()} />
          </Card>
        </div>
        <SupplierHealth suppliers={suppliers.data?.data} />
      </div>

      <Dialog open={current !== null} onClose={() => setOpen(null)} title={current?.name ?? ""} description={current ? `${categoryName(current.category)} · ${current.country} · ${current.face_currency}` : undefined}>
        {current ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3 rounded-xl bg-canvas px-4 py-3">
              <span className="text-sm">
                <span className="font-semibold">Sold to resellers</span>
                <span className="block text-xs text-muted">Hidden products cannot be quoted.</span>
              </span>
              <Toggle label="Product active" checked={current.active} disabled={!operator || productState.isLoading} onChange={active => updateProduct({ id: current.id, active })} />
            </div>
            <div className="flex items-center justify-between gap-3 rounded-xl bg-canvas px-4 py-3">
              <span className="text-sm">
                <span className="font-semibold">Listed on bitocard.com</span>
                <span className="block text-xs text-muted">BitoCard&apos;s store shows only listed products. Resellers list for their own stores.</span>
              </span>
              <Toggle label="Listed on bitocard.com" checked={current.listed} disabled={!operator || productState.isLoading} onChange={listed => updateProduct({ id: current.id, listed })} />
            </div>
            <ProductImage key={`${current.id}:${current.image_url ?? ""}`} product={current} editable={operator} />
            <ul className="space-y-3">
              {current.offers.map(offer => (
                <OfferRow key={offer.id} offer={offer} editable={offerEditor} />
              ))}
            </ul>
            <p className="text-xs text-muted">BitoCard routes each order to the cheapest available offer; when two cost the same, the lower priority number wins. Discounts are what the supplier agreed to give BitoCard.</p>
          </div>
        ) : null}
      </Dialog>

      {bulk ? (
        <ActionDialog
          open
          onClose={() => setBulk(null)}
          title={bulk === "list" ? "List on bitocard.com" : "Unlist from bitocard.com"}
          description={
            bulk === "list"
              ? `Every product matching the filters (${(total - listedCount).toLocaleString("en-GB")} not yet listed) will show on bitocard.com where it is on sale. Resellers' stores are not affected.`
              : `Every listed product matching the filters (${listedCount.toLocaleString("en-GB")}) will be taken off bitocard.com. Resellers' stores are not affected.`
          }
          confirmLabel={bulk === "list" ? "List them" : "Unlist them"}
          tone={bulk === "list" ? "primary" : "danger"}
          requireReason={false}
          onConfirm={async () => {
            const { q: words, ...rest } = filter;
            await setProductListing({ listed: bulk === "list", filter: { ...rest, ...(words ? { q: words } : {}) } }).unwrap();
          }}
        />
      ) : null}
    </AdminShell>
  );
}
