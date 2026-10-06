"use client";

import { useState } from "react";
import { RefreshCw, Search } from "lucide-react";
import { Badge, Button, Card, CardHeader, categoryName, EmptyState, ErrorState, errorMessage, formatMoney, formatRelative, humanise, ImageField, Input, KeyValue, Notice, PageHeader, RefreshFailed, Skeleton, StatusBadge, Tabs, Toggle } from "@bitocard/admin-ui";
import { AdminShell, AppLink, can, useAdmin } from "@bitocard/admin-ui/shell";
import { type ProductCategory, type Supplier, useCountriesQuery, useSetSupplierMarketMutation, useSuppliersQuery, useSyncSupplierMutation, useUpdateSupplierMutation } from "@bitocard/api-client/admin";
import { healthOf } from "../supplier-health";

type Filter = "live" | "all";

/** Words a supplier is found by: name, code, categories, coverage and notes. */
const searchText = (supplier: Supplier) => [supplier.name, supplier.code, supplier.coverage, supplier.notes ?? "", ...supplier.categories.map(categoryName)].join(" ").toLowerCase();

/** The supplier's logo, for the admin app (and SHQ where resellers can connect it). Never shown to customers. */
function SupplierLogo({ supplier, editable }: { supplier: Supplier; editable: boolean }) {
  const [update, state] = useUpdateSupplierMutation();
  const [logo, setLogo] = useState(supplier.logo_url ?? "");
  const changed = logo.trim() !== (supplier.logo_url ?? "");
  return (
    <div className="space-y-2">
      <ImageField label="Logo" realm="admin" purpose="supplier_logo" targetId={supplier.code} value={logo} onChange={setLogo} disabled={!editable} hint="Only admins and resellers who can connect this supplier see it." />
      {changed ? (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {state.error ? <span className="mr-auto text-sm text-red-700">{errorMessage(state.error)}</span> : null}
          <Button size="sm" variant="ghost" onClick={() => setLogo(supplier.logo_url ?? "")}>
            Cancel
          </Button>
          <Button size="sm" disabled={logo.trim() !== "" && !logo.trim().startsWith("https://")} loading={state.isLoading} onClick={() => update({ code: supplier.code, logo_url: logo.trim() || null })}>
            Save logo
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** Categories sold worldwide: one switched-on market is enough for the whole catalogue (the API's worldwideCategories). */
const worldwide = new Set<ProductCategory>(["gift_cards", "esim", "software", "virtual_numbers"]);

/**
 * Where BitoCard uses this supplier: per market (country) and category. The catalogue sync fetches only switched-on
 * markets, so a supplier with none syncs nothing.
 */
function SupplierMarkets({ supplier, editable }: { supplier: Supplier; editable: boolean }) {
  const countries = useCountriesQuery();
  const [setMarket, state] = useSetSupplierMarketMutation();
  const [busy, setBusy] = useState<string | null>(null);
  const on = (country: string, category: ProductCategory) => supplier.markets?.some(market => market.country === country && market.category === category && market.enabled) ?? false;
  const none = !supplier.markets?.some(market => market.enabled);
  const global = supplier.categories.filter(category => worldwide.has(category));
  return (
    <section aria-label={`${supplier.name} markets`} className="space-y-2">
      <h3 className="text-sm font-semibold text-ink">Markets</h3>
      <p className="text-xs text-muted">
        The catalogue sync fetches only switched-on markets.{global.length ? ` ${global.map(categoryName).join(", ")} ${global.length === 1 ? "is" : "are"} worldwide: switching it on in one country syncs the whole catalogue.` : ""}
      </p>
      {none ? <Notice tone="amber">No market is switched on, so a sync fetches nothing. Switch on at least one below.</Notice> : null}
      {state.error ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
      {countries.isLoading ? (
        <Skeleton className="h-20 w-full" />
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line">
          {(countries.data?.data ?? []).map(country => (
            <li key={country.code} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5">
              <span className="w-28 shrink-0 text-sm font-medium text-ink">{country.name}</span>
              <span className="flex flex-wrap gap-1.5">
                {supplier.categories.map(category => {
                  const enabled = on(country.code, category);
                  const key = `${country.code}:${category}`;
                  return (
                    <button
                      key={category}
                      type="button"
                      aria-pressed={enabled}
                      disabled={!editable || busy === key}
                      onClick={async () => {
                        setBusy(key);
                        try {
                          await setMarket({ code: supplier.code, country: country.code, category, enabled: !enabled }).unwrap();
                        } catch {
                          /* shown above */
                        } finally {
                          setBusy(null);
                        }
                      }}
                      className={`rounded-full border px-3 py-1 text-xs font-semibold transition disabled:opacity-60 ${enabled ? "border-brand-600 bg-brand-600 text-white" : "border-line bg-white text-muted hover:border-brand-500 hover:text-ink"}`}
                    >
                      {categoryName(category)}
                    </button>
                  );
                })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SupplierCard({ supplier }: { supplier: Supplier }) {
  const admin = useAdmin();
  const operator = can(admin, "operations");
  const [update, updateState] = useUpdateSupplierMutation();
  const [sync, syncState] = useSyncSupplierMutation();
  const funding = supplier.funding;
  const minimum = (value: number | null) => (value === null ? "Unknown" : funding.currency ? formatMoney(value, funding.currency) : String(value));

  return (
    <Card as="article">
      <div id={supplier.code} className="scroll-mt-24" />
      <CardHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {supplier.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element -- uploaded logos on the storage CDN
              <img src={supplier.logo_url} alt="" className="size-8 rounded-lg border border-line bg-white object-contain p-0.5" />
            ) : null}
            {supplier.name}
            <StatusBadge status={healthOf(supplier)} />
            <Badge dot={false} tone="blue">
              {humanise(supplier.status)}
            </Badge>
          </span>
        }
        description={`${supplier.categories.map(categoryName).join(", ")} · ${supplier.coverage}`}
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              icon={<RefreshCw className="size-4" aria-hidden />}
              loading={syncState.isLoading}
              disabled={!operator || !supplier.configured}
              title={supplier.configured ? undefined : "No API credentials configured"}
              onClick={() => sync(supplier.code)}
            >
              Sync catalogue
            </Button>
            <span className="flex items-center gap-2 text-sm font-medium">
              Switched on
              <Toggle label={`${supplier.name} switched on`} checked={supplier.enabled} disabled={!operator || updateState.isLoading} onChange={enabled => update({ code: supplier.code, enabled })} />
            </span>
          </>
        }
      />
      <div className="space-y-4 p-5 sm:p-6">
        {syncState.data ? (
          <Notice tone="green">{`Synced: ${syncState.data.products_created} new products, ${syncState.data.offers_updated} offers updated, ${syncState.data.offers_withdrawn} withdrawn.`}</Notice>
        ) : null}
        {syncState.data?.note ? (
          <Notice tone="amber" title="Nothing came back">
            {syncState.data.note}
          </Notice>
        ) : null}
        {syncState.error || updateState.error ? <Notice tone="red">{errorMessage(syncState.error ?? updateState.error)}</Notice> : null}
        {supplier.last_sync_error ? <Notice tone="amber" title="Last sync failed">{supplier.last_sync_error}</Notice> : null}
        {!supplier.configured ? <Notice tone="amber">No API credentials are configured, so it serves the sandbox only.</Notice> : null}
        <KeyValue
          items={[
            { label: "Last synced", value: formatRelative(supplier.last_synced_at) },
            { label: "Billing", value: funding.billing_model ? humanise(funding.billing_model) : "Unknown" },
            { label: "Minimum first deposit", value: minimum(funding.min_first_deposit_minor) },
            { label: "Minimum top-up", value: minimum(funding.min_top_up_minor) },
            { label: "Resale to resellers", value: funding.resale_approved ? "Approved in writing" : "Not confirmed" },
            { label: "IP allowlisting", value: supplier.requires_ip_allowlist === null ? "Unknown" : supplier.requires_ip_allowlist ? "Required" : "Not required" },
          ]}
        />
        {supplier.notes ? <p className="text-sm text-muted">{supplier.notes}</p> : null}
        <AppLink href={`/catalog?supplier=${supplier.code}`} className="inline-flex items-center gap-1 text-sm font-semibold text-brand-600 hover:underline">
          View its products and list them on bitocard.com →
        </AppLink>
        <SupplierMarkets supplier={supplier} editable={operator} />
        <SupplierLogo key={supplier.logo_url ?? ""} supplier={supplier} editable={operator} />
      </div>
    </Card>
  );
}

export default function SuppliersPage() {
  const { data, error, isFetching, refetch } = useSuppliersQuery();
  const [filter, setFilter] = useState<Filter>("live");
  const [search, setSearch] = useState("");
  const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  // A search looks through the whole registry, whichever tab is open.
  const suppliers = data?.data.filter(supplier => (words.length ? words.every(word => searchText(supplier).includes(word)) : filter === "all" || supplier.enabled || supplier.status === "mvp_live"));

  return (
    <AdminShell section="catalog" current="/catalog/suppliers" crumbs={[{ label: "Catalog", href: "/catalog" }, { label: "Suppliers" }]}>
      <PageHeader title="Suppliers" description="Every supplier in the registry, its funding profile, and whether BitoCard uses it. Which suppliers are live is configuration, not code." />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 sm:flex-1">
          <Tabs
            label="Show"
            value={filter}
            onChange={setFilter}
            items={[
              { value: "live", label: "In use" },
              { value: "all", label: "Whole registry", count: data?.data.length },
            ]}
          />
        </div>
        <label className="relative flex items-center sm:w-80">
          <span className="sr-only">Search suppliers</span>
          <Search className="pointer-events-none absolute left-4 size-4 text-subtle" aria-hidden />
          <Input type="search" placeholder="Search name, category, country…" value={search} onChange={event => setSearch(event.target.value)} className="min-h-11 rounded-2xl pl-11" />
        </label>
      </div>
      {data && error && !isFetching ? <RefreshFailed message={errorMessage(error)} onRetry={refetch} /> : null}
      {!data && error ? (
        <Card>
          <ErrorState message={errorMessage(error)} onRetry={refetch} />
        </Card>
      ) : !suppliers ? (
        <Skeleton className="h-64 w-full" />
      ) : suppliers.length === 0 ? (
        <Card>
          <EmptyState title={words.length ? "No supplier matches" : "No suppliers in use yet"} icon={<Search className="size-6" aria-hidden />}>
            {words.length ? "Try a supplier's name, a category such as eSIMs, or a country." : "Switch suppliers on from the whole registry."}
          </EmptyState>
        </Card>
      ) : (
        <div className="grid gap-6 xl:grid-cols-2">
          {suppliers.map(supplier => (
            <SupplierCard key={supplier.code} supplier={supplier} />
          ))}
        </div>
      )}
    </AdminShell>
  );
}
