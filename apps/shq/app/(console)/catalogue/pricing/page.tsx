"use client";

import { useDeferredValue, useId, useState, type FormEvent } from "react";
import { BadgePercent, Coins, Plus, Search, ShieldCheck, Trash2 } from "lucide-react";
import {
  Button,
  Card,
  CardHeader,
  categoryName,
  Dialog,
  ErrorState,
  errorMessage,
  formatBps,
  Input,
  Notice,
  PageHeader,
  Skeleton,
  StatCard,
} from "@bitocard/admin-ui";
import {
  type CatalogueCategory,
  catalogueCategories,
  type Markup,
  type Pricing,
  type Product,
  useCatalogueProductsInfiniteQuery,
  useRemoveMarkupMutation,
  usePublicCountryQuery,
  useResellerPricingQuery,
  useSetMarkupMutation,
} from "@bitocard/api-client/reseller";
import { ShqShell } from "@/components/shq-shell";
import { can, useReseller } from "@/components/reseller";

/** "12.5" (per cent) to basis points, or null when it is not a valid percentage. */
function toBps(value: string) {
  const trimmed = value.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  return Math.round(Number(trimmed) * 100);
}
const toPercent = (bps: number) => String(bps / 100);

/** A markup as members who cannot change pricing see it. */
function MarkupRow({ label, current, productId }: { label: string; current: Markup | undefined; productId?: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-6">
      <p className="min-w-0 flex-1 text-sm font-semibold text-ink">{label}</p>
      <p className="text-sm text-muted">{current ? formatBps(current.markup_bps) : productId ? "Category markup" : "No markup"}</p>
    </div>
  );
}

/** One markup: a percentage field with save and remove (read-only for members who cannot change pricing). */
function MarkupEditor({
  label,
  category,
  productId,
  current,
  capPercent,
  editable = true,
}: {
  label: string;
  category: CatalogueCategory;
  productId?: string;
  current: Markup | undefined;
  capPercent: number;
  editable?: boolean;
}) {
  if (!editable) return <MarkupRow label={label} current={current} productId={productId} />;
  return <MarkupForm label={label} category={category} productId={productId} current={current} capPercent={capPercent} />;
}

function MarkupForm({ label, category, productId, current, capPercent }: { label: string; category: CatalogueCategory; productId?: string; current: Markup | undefined; capPercent: number }) {
  const id = useId();
  const [value, setValue] = useState(current ? toPercent(current.markup_bps) : "");
  const [setMarkup, setState] = useSetMarkupMutation();
  const [removeMarkup, removeState] = useRemoveMarkupMutation();
  const [invalid, setInvalid] = useState<string | null>(null);
  const bps = toBps(value);
  const changed = bps !== null && bps !== (current?.markup_bps ?? null);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (bps === null) return setInvalid("Enter a percentage, for example 12.5.");
    if (bps > capPercent * 100) return setInvalid(`At most ${capPercent}%.`);
    setInvalid(null);
    await setMarkup({ category, ...(productId ? { product_id: productId } : {}), markup_bps: bps })
      .unwrap()
      .catch(() => null);
  };
  const remove = async () => {
    const done = await removeMarkup({ category, ...(productId ? { product_id: productId } : {}) })
      .unwrap()
      .catch(() => null);
    if (done) setValue("");
  };
  const error = invalid ?? (setState.error ? errorMessage(setState.error) : removeState.error ? errorMessage(removeState.error) : null);

  return (
    <form onSubmit={save} className="space-y-2 px-5 py-4 sm:px-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1 basis-40">
          <label htmlFor={id} className="block text-sm font-semibold text-ink">
            {label}
          </label>
          <p className="text-xs text-muted">{current ? `Markup ${formatBps(current.markup_bps)}` : productId ? "Uses the category markup" : "No markup"}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative w-28">
            <Input id={id} inputMode="decimal" autoComplete="off" placeholder="0" value={value} onChange={event => setValue(event.target.value)} className="pr-8 text-right" aria-describedby={`${id}-unit`} />
            <span id={`${id}-unit`} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted">
              %
            </span>
          </div>
          <Button type="submit" size="sm" disabled={!changed} loading={setState.isLoading}>
            Save
          </Button>
          {current ? (
            <Button type="button" variant="ghost" size="sm" aria-label={`Remove the markup for ${label}`} loading={removeState.isLoading} onClick={remove} icon={<Trash2 className="size-4" aria-hidden />} />
          ) : null}
        </div>
      </div>
      {error ? <Notice tone="red">{error}</Notice> : null}
    </form>
  );
}

/** A product markup row, named by the API (a product no longer sold shows its ID). */
function ProductMarkup({ markup, capPercent, editable }: { markup: Markup & { product_id: string }; capPercent: number; editable: boolean }) {
  const name = markup.product_name ?? `Product ${markup.product_id.slice(0, 8)} (no longer sold)`;
  return (
    <MarkupEditor key={markup.markup_bps} label={`${name} · ${categoryName(markup.category)}`} category={markup.category} productId={markup.product_id} current={markup} capPercent={capPercent} editable={editable} />
  );
}

function AddProductMarkup({ open, onClose, pricing }: { open: boolean; onClose: () => void; pricing: Pricing }) {
  const [search, setSearch] = useState("");
  const q = useDeferredValue(search.trim());
  const query = useCatalogueProductsInfiniteQuery({ q: q || undefined, limit: 10 }, { skip: !open });
  const rows = query.data?.pages.flatMap(page => page.data);
  const [product, setProduct] = useState<Product | null>(null);
  const close = () => {
    setProduct(null);
    setSearch("");
    onClose();
  };
  return (
    <Dialog open={open} onClose={close} title="Markup for one product" description="Overrides its category markup.">
      {product ? (
        <div className="-mx-5 space-y-3 sm:-mx-6">
          <MarkupEditor
            label={product.name}
            category={product.category}
            productId={product.id}
            current={pricing.markups.find(markup => markup.product_id === product.id)}
            capPercent={pricing.markup_cap_percent}
          />
          <div className="px-5 sm:px-6">
            <Button variant="ghost" size="sm" onClick={() => setProduct(null)}>
              Choose another product
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <label className="relative flex items-center">
            <span className="sr-only">Search products</span>
            <Search className="pointer-events-none absolute left-3 size-4 text-subtle" aria-hidden />
            <Input type="search" placeholder="Search by name or brand" value={search} maxLength={60} onChange={event => setSearch(event.target.value)} className="pl-9" />
          </label>
          {query.error ? (
            <Notice tone="red">{errorMessage(query.error)}</Notice>
          ) : query.isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : rows?.length ? (
            <ul className="divide-y divide-line rounded-xl border border-line">
              {rows.map(item => (
                <li key={item.id}>
                  <button type="button" onClick={() => setProduct(item)} className="flex min-h-12 w-full flex-col justify-center px-4 py-2 text-left hover:bg-canvas">
                    <span className="font-semibold text-ink">{item.name}</span>
                    <span className="text-xs text-muted">{`${categoryName(item.category)} · ${item.country}`}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">No products match.</p>
          )}
          {query.hasNextPage ? (
            <Button variant="ghost" size="sm" loading={query.isFetchingNextPage} onClick={() => query.fetchNextPage()}>
              Show more
            </Button>
          ) : null}
        </div>
      )}
    </Dialog>
  );
}

function PricingSettings({ editable }: { editable: boolean }) {
  const { membership } = useReseller();
  const { data: pricing, error, isLoading, refetch } = useResellerPricingQuery();
  // Only the categories sold in the reseller's country (all of them until the country is known).
  const country = usePublicCountryQuery(membership.reseller.country ?? "", { skip: !membership.reseller.country });
  const sold = country.data ? new Set(country.data.categories.map(item => item.category)) : null;
  const [adding, setAdding] = useState(false);

  if (error) {
    return (
      <Card>
        <ErrorState message={errorMessage(error, "Could not load your pricing.")} onRetry={refetch} />
      </Card>
    );
  }
  if (isLoading || !pricing) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading pricing">
        <div className="grid gap-4 sm:grid-cols-2">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  const categoryMarkup = (category: CatalogueCategory) => pricing.markups.find(markup => markup.category === category && markup.product_id === null);
  const productMarkups = pricing.markups.filter((markup): markup is Markup & { product_id: string } => markup.product_id !== null);

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard label="Markup cap" icon={<ShieldCheck />} tone="green" value={`${pricing.markup_cap_percent}%`} footer={<p className="text-xs text-muted">Markup Protection Scheme: the most above wholesale price.</p>} />
        <StatCard
          label="Face-value products"
          icon={<Coins />}
          tone="blue"
          value={pricing.earning === "discount" ? "BitoCard discount" : "Your markup"}
          footer={<p className="text-xs text-muted">How you earn on airtime, data, pay-TV and bills.</p>}
        />
      </div>
      <Notice tone="grey">
        {pricing.earning === "discount"
          ? "Airtime, data, pay-TV and bills sell at face value and you earn BitoCard's discount, so markups do not apply to them. Your markups apply to everything else."
          : `Your markup is added on top of the wholesale price (or the face value for airtime, data, pay-TV and bills). Prices are in ${pricing.currency}.`}{" "}
        A product markup overrides its category markup.
      </Notice>

      <Card>
        <CardHeader title="Category markups" description={`Up to ${pricing.markup_cap_percent}%. Products you can sell depend on your country.`} />
        <div className="mt-2 divide-y divide-line">
          {catalogueCategories
            .filter(category => !sold || sold.has(category) || categoryMarkup(category))
            .map(category => {
              const current = categoryMarkup(category);
              return (
                <MarkupEditor
                  key={`${category}-${current?.markup_bps ?? "none"}`}
                  label={categoryName(category)}
                  category={category}
                  current={current}
                  capPercent={pricing.markup_cap_percent}
                  editable={editable}
                />
              );
            })}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Product markups"
          description="For products that need a different markup from their category."
          actions={
            editable ? (
              <Button variant="secondary" size="sm" icon={<Plus className="size-4" aria-hidden />} onClick={() => setAdding(true)}>
                Add
              </Button>
            ) : null
          }
        />
        <div className="mt-2 divide-y divide-line">
          {productMarkups.length ? (
            productMarkups.map(markup => <ProductMarkup key={markup.product_id} markup={markup} capPercent={pricing.markup_cap_percent} editable={editable} />)
          ) : (
            <p className="px-5 pb-5 text-sm text-muted sm:px-6">No product markups. Every product uses its category markup.</p>
          )}
        </div>
      </Card>
      {editable ? <AddProductMarkup open={adding} onClose={() => setAdding(false)} pricing={pricing} /> : null}
    </>
  );
}

export default function PricingPage() {
  const { membership } = useReseller();
  const allowed = can(membership, "admin");
  return (
    <ShqShell section="catalogue" current="/catalogue/pricing" crumbs={[{ label: "Catalogue", href: "/catalogue" }, { label: "Pricing" }]}>
      <PageHeader title="Pricing" description="Your markups over BitoCard's wholesale price. Changes apply to new quotes straight away." />
      {allowed ? null : (
        <Card className="p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <BadgePercent className="mt-0.5 size-5 shrink-0 text-muted" aria-hidden />
            <p className="text-sm text-muted">Only the owner and admins can change markups.</p>
          </div>
        </Card>
      )}
      <PricingSettings editable={allowed} />
    </ShqShell>
  );
}
