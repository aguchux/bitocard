"use client";

import { useDeferredValue, useState } from "react";
import { AlertTriangle, Database, Globe2, Package, Search } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  categoryName,
  DataTable,
  Dialog,
  errorMessage,
  FilterSelect,
  formatBps,
  formatRelative,
  Input,
  LoadMore,
  Notice,
  PageHeader,
  StatCard,
  StatusBadge,
  Toggle,
} from "@bitocard/admin-ui";
import { AdminShell, can, useAdmin } from "@bitocard/admin-ui/shell";
import {
  type AdminProduct,
  productCategories,
  type ProductCategory,
  type SupplierOffer,
  useCountriesQuery,
  useProductsInfiniteQuery,
  useSuppliersQuery,
  useUpdateOfferMutation,
  useUpdateProductMutation,
} from "@bitocard/api-client/admin";
import { healthOf, SupplierHealth } from "./supplier-health";

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
          <Toggle label={`${offer.supplier} available`} checked={offer.available} disabled={!editable || state.isLoading} onChange={available => update({ id: offer.id, available })} />
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

export default function ProductsPage() {
  const admin = useAdmin();
  const [country, setCountry] = useState("");
  const [category, setCategory] = useState<"" | ProductCategory>("");
  const [search, setSearch] = useState("");
  const q = useDeferredValue(search.trim());
  const [open, setOpen] = useState<AdminProduct | null>(null);
  const products = useProductsInfiniteQuery({ country: country || undefined, category: category || undefined, q: q.length >= 2 ? q : undefined });
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
            <label className="relative flex min-w-56 flex-1 items-center">
              <span className="sr-only">Search products</span>
              <Search className="pointer-events-none absolute left-4 size-4 text-subtle" aria-hidden />
              <Input type="search" placeholder="Search products…" value={search} onChange={event => setSearch(event.target.value)} className="min-h-[3.75rem] rounded-2xl pl-11" />
            </label>
          </div>
          {productState.error ? <Notice tone="red">{errorMessage(productState.error)}</Notice> : null}
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
                    <span>
                      <span className="font-semibold">{product.name}</span>
                      <span className="block font-mono text-xs text-muted">{product.key}</span>
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
            <ul className="space-y-3">
              {current.offers.map(offer => (
                <OfferRow key={offer.id} offer={offer} editable={offerEditor} />
              ))}
            </ul>
            <p className="text-xs text-muted">BitoCard routes each order to the cheapest available offer; when two cost the same, the lower priority number wins. Discounts are what the supplier agreed to give BitoCard.</p>
          </div>
        ) : null}
      </Dialog>
    </AdminShell>
  );
}
