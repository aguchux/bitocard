"use client";

import { useState, type FormEvent } from "react";
import { Badge, Button, Card, errorMessage, formatNumber, Input, Notice, PageHeader, QueryView, Skeleton, Toggle } from "@bitocard/admin-ui";
import { can, useAdmin } from "@bitocard/admin-ui/shell";
import { UdozoShell } from "@/components/shell";
import { type AdminClassifiedCategory, useClassifiedCategoriesQuery, useSetClassifiedCategoryCountryMutation, useSetClassifiedCategoryMutation, useSetClassifiedCategorySkuPrefixMutation } from "@bitocard/api-client/admin";
import { MarketFilter } from "@/components/classifieds";

/**
 * Udozo > Categories: which categories are open in each market (closing a top category closes its
 * subcategories there), and switching one off everywhere. Closing stops new ads; live ones stay until they end.
 * Each category's SKU prefix starts its ads' SKUs (PHN-000123). Operations change them (switches shown at once,
 * undone if refused); each change is audited.
 */
export default function ClassifiedCategoriesPage() {
  const admin = useAdmin();
  const [country, setCountry] = useState("NG");
  const categories = useClassifiedCategoriesQuery(country);
  const [setOpen, opening] = useSetClassifiedCategoryCountryMutation();
  const [setEnabled, enabling] = useSetClassifiedCategoryMutation();
  const changes = can(admin, "operations");
  const failed = opening.error ?? enabling.error;
  const row = (category: AdminClassifiedCategory, top: boolean) => (
    <CategoryRow
      key={category.id}
      category={category}
      top={top}
      country={country}
      changes={changes}
      onOpen={open => void setOpen({ id: category.id, country, open })}
      onEnable={enabled => void setEnabled({ id: category.id, enabled })}
    />
  );

  return (
    <UdozoShell section="marketplace" current="/classifieds/categories" crumbs={[{ label: "Marketplace", href: "/classifieds" }, { label: "Categories" }]}>
      <PageHeader title="Categories" description="What sellers can post in each market. Closing a category stops new ads in it; ads already live stay until they end or are removed. Each category's three letters start its ads' SKUs." />
      <div className="mt-6 flex flex-wrap gap-3">
        <MarketFilter id="categories-market" value={country} onChange={setCountry} all={false} />
      </div>
      {failed ? (
        <div className="mt-4">
          <Notice tone="red">{errorMessage(failed)}</Notice>
        </div>
      ) : null}
      <div className="mt-4">
        <QueryView query={categories} loading={<Skeleton className="h-96 w-full" />}>
          {data => (
            <ul className="space-y-4">
              {data.data.map(top => (
                <li key={top.id}>
                  <Card>
                    {row(top, true)}
                    {top.children.length ? <div className="divide-y divide-line border-t border-line pb-2">{top.children.map(child => row(child, false))}</div> : null}
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </QueryView>
      </div>
    </UdozoShell>
  );
}

function CategoryRow({
  category,
  top,
  country,
  changes,
  onOpen,
  onEnable,
}: {
  category: AdminClassifiedCategory;
  top: boolean;
  country: string;
  changes: boolean;
  onOpen: (open: boolean) => void;
  onEnable: (enabled: boolean) => void;
}) {
  return (
    <div className={top ? "flex flex-wrap items-center gap-3 px-5 py-4 sm:px-6" : "flex flex-wrap items-center gap-3 py-2.5 pl-10 pr-5 sm:pr-6"}>
      <span className="min-w-0 flex-1">
        <span className={top ? "block font-semibold text-ink" : "block text-sm text-ink"}>{category.name}</span>
        <span className="block text-xs text-muted">
          {formatNumber(category.active_listings)} live ads{category.b2b ? " · for businesses" : ""}
        </span>
      </span>
      {!category.enabled ? <Badge tone="grey">Off everywhere</Badge> : null}
      <SkuPrefix category={category} changes={changes} />
      <span className="flex items-center gap-2 text-xs font-semibold text-muted">
        Open in {country}
        <Toggle label={`${category.name}: open in ${country}`} checked={category.open} disabled={!changes} onChange={onOpen} />
      </span>
      <span className="flex items-center gap-2 text-xs font-semibold text-muted">
        On everywhere
        <Toggle label={`${category.name}: on everywhere`} checked={category.enabled} disabled={!changes} onChange={onEnable} />
      </span>
    </div>
  );
}

/** The category's SKU prefix; operations change it here. Ads already given a SKU keep it. */
function SkuPrefix({ category, changes }: { category: AdminClassifiedCategory; changes: boolean }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(category.sku_prefix);
  const [save, saving] = useSetClassifiedCategorySkuPrefixMutation();
  const [error, setError] = useState<string | null>(null);
  const valid = /^[A-Z]{3}$/.test(value);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    setError(null);
    try {
      await save({ id: category.id, sku_prefix: value }).unwrap();
      setEditing(false);
    } catch (problem) {
      setError(errorMessage(problem));
    }
  };
  if (!editing) {
    return changes ? (
      <button
        type="button"
        onClick={() => (setValue(category.sku_prefix), setError(null), setEditing(true))}
        aria-label={`${category.name}: SKU prefix ${category.sku_prefix}, change it`}
        title="SKU prefix"
        className="rounded-lg border border-line bg-white px-2 py-1 font-mono text-xs font-bold tracking-wider text-ink hover:border-brand-400 hover:text-brand-600"
      >
        {category.sku_prefix}
      </button>
    ) : (
      <span title="SKU prefix" className="rounded-lg bg-canvas px-2 py-1 font-mono text-xs font-bold tracking-wider text-ink">
        {category.sku_prefix}
      </span>
    );
  }
  return (
    <form onSubmit={submit} className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
      <label className="sr-only" htmlFor={`sku-${category.id}`}>
        {category.name}: SKU prefix
      </label>
      <Input
        id={`sku-${category.id}`}
        value={value}
        maxLength={3}
        autoFocus
        onChange={event => setValue(event.target.value.toUpperCase().replace(/[^A-Z]/g, ""))}
        onKeyDown={event => event.key === "Escape" && setEditing(false)}
        aria-invalid={!valid}
        className="w-20 font-mono font-bold tracking-wider uppercase"
      />
      <Button type="submit" size="sm" loading={saving.isLoading} disabled={!valid || value === category.sku_prefix}>
        Save
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
        Cancel
      </Button>
      <span className="basis-full text-xs text-muted">{error ?? "Three letters. New ads take it; SKUs already given keep theirs."}</span>
    </form>
  );
}
