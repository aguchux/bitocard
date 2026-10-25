"use client";

import { useState } from "react";
import { Badge, Card, errorMessage, formatNumber, Notice, PageHeader, QueryView, Skeleton, Toggle } from "@bitocard/admin-ui";
import { AdminShell, can, useAdmin } from "@bitocard/admin-ui/shell";
import { type AdminClassifiedCategory, useClassifiedCategoriesQuery, useSetClassifiedCategoryCountryMutation, useSetClassifiedCategoryMutation } from "@bitocard/api-client/admin";
import { MarketFilter } from "@/components/classifieds";

/**
 * BitoCard Shop > Categories: which categories are open in each market (closing a top category closes its
 * subcategories there), and switching one off everywhere. Closing stops new ads; live ones stay until they end.
 * Operations change them (shown at once, undone if refused); each change is audited.
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
    <AdminShell section="classifieds" current="/classifieds/categories" crumbs={[{ label: "BitoCard Shop", href: "/classifieds" }, { label: "Categories" }]}>
      <PageHeader title="Categories" description="What sellers can post in each market. Closing a category stops new ads in it; ads already live stay until they end or are removed." />
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
    </AdminShell>
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
      <Toggle label={`Open in ${country}`} checked={category.open} disabled={!changes} onChange={onOpen} />
      <Toggle label="On everywhere" checked={category.enabled} disabled={!changes} onChange={onEnable} />
    </div>
  );
}
