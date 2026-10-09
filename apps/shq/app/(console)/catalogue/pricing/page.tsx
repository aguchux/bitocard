"use client";

import { useId, useState, type FormEvent } from "react";
import { BadgePercent, Plus, Search, ShieldCheck, Trash2 } from "lucide-react";
import {
  bpsToPercent,
  Button,
  Card,
  CardHeader,
  categoryName,
  Dialog,
  errorMessage,
  ErrorState,
  formatBps,
  formatMoney,
  Input,
  Notice,
  PageHeader,
  percentToBps,
  PricingSchemes,
  RefreshFailed,
  Skeleton,
  StatCard,
  useDebouncedValue,
} from "@bitocard/admin-ui";
import {
  type CatalogueCategory,
  catalogueCategories,
  type Markup,
  type Product,
  useCatalogueProductQuery,
  useCatalogueProductsInfiniteQuery,
  usePublicCountryQuery,
  useRemoveMarkupMutation,
  useResellerPricingQuery,
  useSetMarkupMutation,
} from "@bitocard/api-client/reseller";
import { ProductPricingDialog } from "@/components/product-pricing";
import { ShqShell } from "@/components/shq-shell";
import { can, useReseller } from "@/components/reseller";

/** A setting in words: "Not set" when blank (the wider setting applies). */
const shown = (bps: number | null | undefined, inherit: string) => (bps === null || bps === undefined ? inherit : formatBps(bps));

/** One percentage field (blank means "use the wider setting"). */
function PercentInput({ id, label, value, onChange, placeholder }: { id: string; label: string; value: string; onChange: (value: string) => void; placeholder: string }) {
  return (
    <div className="w-36">
      <label htmlFor={id} className="block text-xs font-semibold text-muted">
        {label}
      </label>
      <div className="relative mt-1">
        <Input id={id} inputMode="decimal" autoComplete="off" placeholder={placeholder} value={value} onChange={event => onChange(event.target.value)} className="pr-8 text-right" />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted">%</span>
      </div>
    </div>
  );
}

/**
 * The general setting (no category) or one category's: how much of your discount customers get on discount products,
 * and your markup on markup products. Blank leaves it to the wider setting.
 */
function SettingRow({ label, category, current, capPercent, editable, inherit }: { label: string; category: CatalogueCategory | null; current: Markup | undefined; capPercent: number; editable: boolean; inherit: string }) {
  const id = useId();
  const [discount, setDiscount] = useState(bpsToPercent(current?.customer_discount_bps));
  const [markup, setMarkup] = useState(bpsToPercent(current?.markup_bps));
  const [save, saveState] = useSetMarkupMutation();
  const [remove, removeState] = useRemoveMarkupMutation();
  const [invalid, setInvalid] = useState<string | null>(null);
  const discountBps = discount.trim() === "" ? null : percentToBps(discount);
  const markupBps = markup.trim() === "" ? null : percentToBps(markup);
  const changed = discountBps !== (current?.customer_discount_bps ?? null) || markupBps !== (current?.markup_bps ?? null);

  if (!editable) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-6">
        <p className="min-w-0 flex-1 text-sm font-semibold text-ink">{label}</p>
        <p className="text-sm text-muted">{`Customers get ${shown(current?.customer_discount_bps, inherit)} · markup ${shown(current?.markup_bps, inherit)}`}</p>
      </div>
    );
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if ((discount.trim() !== "" && discountBps === null) || (markup.trim() !== "" && markupBps === null)) return setInvalid("Enter percentages, for example 1.5.");
    if (discountBps !== null && discountBps > 10_000) return setInvalid("A customer discount is at most 100%.");
    if (markupBps !== null && markupBps > capPercent * 100) return setInvalid(`Your markup is at most ${capPercent}%.`);
    setInvalid(null);
    await save({ category, customer_discount_bps: discountBps, markup_bps: markupBps })
      .unwrap()
      .catch(() => null);
  };
  const clear = async () => {
    const done = await remove(category ? { category } : {})
      .unwrap()
      .catch(() => null);
    if (done) {
      setDiscount("");
      setMarkup("");
    }
  };
  const error = invalid ?? (saveState.error ? errorMessage(saveState.error) : removeState.error ? errorMessage(removeState.error) : null);

  return (
    <form onSubmit={submit} className="space-y-2 px-5 py-4 sm:px-6">
      <div className="flex flex-wrap items-end gap-3">
        <p className="min-w-0 flex-1 basis-40 pb-2 text-sm font-semibold text-ink">{label}</p>
        <PercentInput id={`${id}-discount`} label="Customers get" placeholder={category ? "General" : "0"} value={discount} onChange={setDiscount} />
        <PercentInput id={`${id}-markup`} label="Your markup" placeholder={category ? "General" : "0"} value={markup} onChange={setMarkup} />
        <div className="flex items-center gap-2">
          <Button type="submit" size="sm" disabled={!changed} loading={saveState.isLoading}>
            Save
          </Button>
          {current ? (
            <Button type="button" variant="ghost" size="sm" aria-label={`Clear the setting for ${label}`} loading={removeState.isLoading} onClick={clear} icon={<Trash2 className="size-4" aria-hidden />} />
          ) : null}
        </div>
      </div>
      {error ? <Notice tone="red">{error}</Notice> : null}
    </form>
  );
}

/** A product's own setting, in words. */
function describeProduct(markup: Markup, currency: string) {
  if (markup.fixed_price !== null) return `Fixed price ${formatMoney(markup.fixed_price, currency)}`;
  const parts = [markup.customer_discount_bps !== null ? `customers get ${formatBps(markup.customer_discount_bps)}` : null, markup.markup_bps !== null ? `markup ${formatBps(markup.markup_bps)}` : null].filter(Boolean);
  return parts.length ? parts.join(" · ").replace(/^./, letter => letter.toUpperCase()) : "Uses your category or general setting";
}

/** Opens a product's pricing popup once the product is loaded. */
function EditProduct({ productId, manage, onClose }: { productId: string; manage: boolean; onClose: () => void }) {
  const product = useCatalogueProductQuery(productId);
  if (product.error) {
    return (
      <Dialog open onClose={onClose} title="Product pricing">
        <Notice tone="red">{errorMessage(product.error, "This product is no longer sold to you. Remove its setting instead.")}</Notice>
      </Dialog>
    );
  }
  return product.data ? <ProductPricingDialog product={product.data} open manage={manage} onClose={onClose} /> : null;
}

function ProductRow({ markup, currency, editable, onEdit }: { markup: Markup & { product_id: string }; currency: string; editable: boolean; onEdit: (id: string) => void }) {
  const [remove, removeState] = useRemoveMarkupMutation();
  const name = markup.product_name ?? `Product ${markup.product_id.slice(0, 8)} (no longer sold)`;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-6">
      <div className="min-w-0 flex-1 basis-48">
        <p className="text-sm font-semibold text-ink">{name}</p>
        <p className="text-xs text-muted">{`${markup.category ? `${categoryName(markup.category)} · ` : ""}${describeProduct(markup, currency)}`}</p>
        {removeState.error ? <p className="mt-1 text-xs text-red-700">{errorMessage(removeState.error)}</p> : null}
      </div>
      <div className="flex items-center gap-2">
        {markup.product_name ? (
          <Button variant="secondary" size="sm" onClick={() => onEdit(markup.product_id)}>
            {editable ? "Edit" : "View"}
          </Button>
        ) : null}
        {editable ? (
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Remove the setting for ${name}`}
            loading={removeState.isLoading}
            onClick={() => void remove({ product_id: markup.product_id }).unwrap().catch(() => null)}
            icon={<Trash2 className="size-4" aria-hidden />}
          />
        ) : null}
      </div>
    </div>
  );
}

function ChooseProduct({ open, onClose, onChoose }: { open: boolean; onClose: () => void; onChoose: (product: Product) => void }) {
  const [search, setSearch] = useState("");
  const q = useDebouncedValue(search.trim());
  const query = useCatalogueProductsInfiniteQuery({ q: q || undefined, limit: 10 }, { skip: !open });
  const rows = query.data?.pages.flatMap(page => page.data);
  const close = () => {
    setSearch("");
    onClose();
  };
  return (
    <Dialog open={open} onClose={close} title="Price one product" description="Its own setting wins over its category and your general setting.">
      <div className="space-y-3">
        <label className="relative flex items-center">
          <span className="sr-only">Search products</span>
          <Search className="pointer-events-none absolute left-3 size-4 text-subtle" aria-hidden />
          <Input type="search" placeholder="Search by name or brand" value={search} maxLength={60} onChange={event => setSearch(event.target.value)} className="pl-9" />
        </label>
        {query.error && rows && !query.isFetching ? <RefreshFailed message={errorMessage(query.error)} onRetry={query.refetch} /> : null}
        {!rows && query.error ? (
          <Notice tone="red">{errorMessage(query.error)}</Notice>
        ) : !rows && query.isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : rows?.length ? (
          <ul className="divide-y divide-line rounded-xl border border-line">
            {rows.map(item => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => {
                    setSearch("");
                    onChoose(item);
                  }}
                  className="flex min-h-12 w-full flex-col justify-center px-4 py-2 text-left hover:bg-canvas"
                >
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
    </Dialog>
  );
}

function PricingSettings({ editable }: { editable: boolean }) {
  const { membership } = useReseller();
  const { data: pricing, error, isFetching, refetch } = useResellerPricingQuery();
  // Only the categories sold in the reseller's country (all of them until the country is known).
  const country = usePublicCountryQuery(membership.reseller.country ?? "", { skip: !membership.reseller.country });
  const sold = country.data ? new Set(country.data.categories.map(item => item.category)) : null;
  const [choosing, setChoosing] = useState(false);
  const [chosen, setChosen] = useState<Product | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  if (!pricing) {
    if (error) {
      return (
        <Card>
          <ErrorState message={errorMessage(error, "Could not load your pricing.")} onRetry={refetch} />
        </Card>
      );
    }
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading pricing">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  const general = pricing.markups.find(markup => markup.category === null && markup.product_id === null);
  const categorySetting = (category: CatalogueCategory) => pricing.markups.find(markup => markup.category === category && markup.product_id === null);
  const products = pricing.markups.filter((markup): markup is Markup & { product_id: string } => markup.product_id !== null);
  const key = (markup: Markup | undefined) => `${markup?.customer_discount_bps ?? "-"}:${markup?.markup_bps ?? "-"}`;

  return (
    <>
      {error && !isFetching ? <RefreshFailed message={errorMessage(error, "Could not load your pricing.")} onRetry={refetch} /> : null}
      <PricingSchemes audience="reseller" />
      <StatCard
        label="Markup cap"
        icon={<ShieldCheck />}
        tone="green"
        value={`${pricing.markup_cap_percent}%`}
        footer={<p className="text-xs text-muted">Markup Protection Scheme: the most you can add to BitoCard’s price on markup products.</p>}
      />
      <Notice tone="grey">
        {`“Customers get” is how much of your discount you pass on (a percentage of face value; never more than your own discount). “Your markup” is added to BitoCard’s price on markup products. A product’s own setting wins over its category, and a category’s over your general setting. Prices are in ${pricing.currency}.`}
      </Notice>

      <Card>
        <CardHeader title="General" description="Applies to every product without its own or its category’s setting." />
        <div className="mt-2">
          <SettingRow key={key(general)} label="All products" category={null} current={general} capPercent={pricing.markup_cap_percent} editable={editable} inherit="0%" />
        </div>
      </Card>

      <Card>
        <CardHeader title="Categories" description="Leave a field blank to use your general setting. Products you can sell depend on your country." />
        <div className="mt-2 divide-y divide-line">
          {catalogueCategories
            .filter(category => !sold || sold.has(category) || categorySetting(category))
            .map(category => {
              const current = categorySetting(category);
              return (
                <SettingRow
                  key={`${category}-${key(current)}`}
                  label={categoryName(category)}
                  category={category}
                  current={current}
                  capPercent={pricing.markup_cap_percent}
                  editable={editable}
                  inherit="general"
                />
              );
            })}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Products"
          description="A product’s own discount, markup or fixed price, with what you make per sale. You can also set it when you list a product."
          actions={
            editable ? (
              <Button variant="secondary" size="sm" icon={<Plus className="size-4" aria-hidden />} onClick={() => setChoosing(true)}>
                Add
              </Button>
            ) : null
          }
        />
        <div className="mt-2 divide-y divide-line">
          {products.length ? (
            products.map(markup => <ProductRow key={markup.product_id} markup={markup} currency={pricing.currency} editable={editable} onEdit={setEditing} />)
          ) : (
            <p className="px-5 pb-5 text-sm text-muted sm:px-6">No product settings. Every product uses its category or your general setting.</p>
          )}
        </div>
      </Card>
      {editable ? (
        <ChooseProduct
          open={choosing}
          onClose={() => setChoosing(false)}
          onChoose={product => {
            setChoosing(false);
            setChosen(product);
          }}
        />
      ) : null}
      {chosen ? <ProductPricingDialog key={chosen.id} product={chosen} open manage={editable} onClose={() => setChosen(null)} /> : null}
      {editing ? <EditProduct key={editing} productId={editing} manage={editable} onClose={() => setEditing(null)} /> : null}
    </>
  );
}

export default function PricingPage() {
  const { membership } = useReseller();
  const allowed = can(membership, "admin");
  return (
    <ShqShell section="catalogue" current="/catalogue/pricing" crumbs={[{ label: "Catalogue", href: "/catalogue" }, { label: "Pricing" }]}>
      <PageHeader title="Pricing" description="How you price BitoCard’s products for your customers. Changes apply to new quotes straight away." />
      {allowed ? null : (
        <Card className="p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <BadgePercent className="mt-0.5 size-5 shrink-0 text-muted" aria-hidden />
            <p className="text-sm text-muted">Only the owner and admins can change pricing.</p>
          </div>
        </Card>
      )}
      <PricingSettings editable={allowed} />
    </ShqShell>
  );
}
