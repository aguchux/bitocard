"use client";

import { useState } from "react";
import { Button, Card, CardHeader, ErrorState, errorMessage, ImageField, PageHeader, Skeleton } from "@bitocard/admin-ui";
import { AdminShell, can, useAdmin } from "@bitocard/admin-ui/shell";
import { type AdminCategory, useSaveStorefrontCategoryMutation, useStorefrontCategoriesQuery } from "@bitocard/api-client/admin";

const valid = (value: string) => !value.trim() || value.trim().startsWith("https://");

function CategoryCard({ category, editable }: { category: AdminCategory; editable: boolean }) {
  const [save, state] = useSaveStorefrontCategoryMutation();
  const [icon, setIcon] = useState(category.icon_url ?? "");
  const [image, setImage] = useState(category.image_url ?? "");
  const changed = icon.trim() !== (category.icon_url ?? "") || image.trim() !== (category.image_url ?? "");
  return (
    <Card as="article">
      <CardHeader title={category.label} description={`${category.products.toLocaleString("en-GB")} product${category.products === 1 ? "" : "s"}`} />
      <div className="space-y-4 p-5 sm:p-6">
        <ImageField label="Icon" realm="admin" purpose="category_icon" targetId={category.category} value={icon} onChange={setIcon} disabled={!editable} hint="Shown in menus and category shortcuts." />
        <ImageField label="Image" realm="admin" purpose="category_image" targetId={category.category} value={image} onChange={setImage} disabled={!editable} shape="wide" hint="A banner for the category's page." />
        {editable ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {state.error ? <span className="mr-auto text-sm text-red-700">{errorMessage(state.error)}</span> : null}
            <Button
              size="sm"
              disabled={!changed || !valid(icon) || !valid(image)}
              loading={state.isLoading}
              onClick={() => save({ category: category.category, icon_url: icon.trim() || null, image_url: image.trim() || null })}
            >
              Save
            </Button>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

/** Storefront Manager: each category's icon and image on bitocard.com and the stores. */
export default function StorefrontCategoriesPage() {
  const admin = useAdmin();
  const editable = can(admin, "operations");
  const categories = useStorefrontCategoriesQuery();
  return (
    <AdminShell section="storefront" current="/storefront/categories" crumbs={[{ label: "Storefront", href: "/storefront" }, { label: "Categories" }]}>
      <PageHeader title="Categories" description="Icons and images for each category, shown in menus, category grids and category pages. Names are fixed." />
      {categories.error ? (
        <Card>
          <ErrorState message={errorMessage(categories.error)} onRetry={categories.refetch} />
        </Card>
      ) : !categories.data ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2 2xl:grid-cols-3">
          {categories.data.data.map(category => (
            <CategoryCard key={`${category.category}:${category.icon_url ?? ""}:${category.image_url ?? ""}`} category={category} editable={editable} />
          ))}
        </div>
      )}
    </AdminShell>
  );
}
