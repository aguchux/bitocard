"use client";

import { useDeferredValue, useId, useState } from "react";
import { Search } from "lucide-react";
import { ActionDialog, Badge, Card, type Column, DataTable, Dialog, errorMessage, Field, ImageField, Input, PageHeader, StatusBadge, Textarea, Toggle } from "@bitocard/admin-ui";
import { AdminShell, can, useAdmin } from "@bitocard/admin-ui/shell";
import { type AdminBrand, type BrandInput, useSaveStorefrontBrandMutation, useStorefrontBrandsQuery } from "@bitocard/api-client/admin";
import { categoryLabels } from "@bitocard/api-client/storefront";

const hex = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const https = /^https:\/\/\S+$/;
const list = (value: string) =>
  value
    .split(",")
    .map(item => item.trim())
    .filter(Boolean);
const orNull = (value: string) => (value.trim() ? value.trim() : null);

function Swatch({ brand }: { brand: AdminBrand }) {
  if (brand.logo_url) {
    // eslint-disable-next-line @next/next/no-img-element -- brand logos are on outside hosts the image optimiser is not configured for
    return <img src={brand.logo_url} alt="" className="size-9 shrink-0 rounded-lg border border-line bg-white object-contain p-1" />;
  }
  return (
    <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-lg text-sm font-bold text-white" style={{ background: brand.color ?? "#94a3b8" }}>
      {brand.name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function BrandDialog({ brand, editable, onClose }: { brand: AdminBrand; editable: boolean; onClose: () => void }) {
  const id = useId();
  const [save] = useSaveStorefrontBrandMutation();
  const [name, setName] = useState(brand.name);
  const [company, setCompany] = useState(brand.company ?? "");
  const [description, setDescription] = useState(brand.description ?? "");
  const [logo, setLogo] = useState(brand.logo_url ?? "");
  const [image, setImage] = useState(brand.image_url ?? "");
  const [color, setColor] = useState(brand.color ?? "");
  const [tags, setTags] = useState(brand.tags.join(", "));
  const [aliases, setAliases] = useState(brand.aliases.join(", "));
  const [featured, setFeatured] = useState(brand.featured);
  const [sortOrder, setSortOrder] = useState(String(brand.sort_order));
  const [visible, setVisible] = useState(brand.visible);

  const problems = {
    name: name.trim() ? undefined : "A name is required.",
    logo: logo.trim() && !https.test(logo.trim()) ? "Use an https:// address." : undefined,
    image: image.trim() && !https.test(image.trim()) ? "Use an https:// address." : undefined,
    color: color.trim() && !hex.test(color.trim()) ? "Use a hex colour such as #FF9900." : undefined,
    sort: /^\d+$/.test(sortOrder) && Number(sortOrder) <= 10_000 ? undefined : "A whole number from 0 to 10,000.",
  };

  const form = (
    <fieldset disabled={!editable} className="min-w-0 space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor={`${id}-name`} error={problems.name}>
          <Input id={`${id}-name`} value={name} maxLength={80} onChange={event => setName(event.target.value)} />
        </Field>
        <Field label="Company" htmlFor={`${id}-company`} hint="Optional, for example Amazon.com, Inc.">
          <Input id={`${id}-company`} value={company} maxLength={120} onChange={event => setCompany(event.target.value)} />
        </Field>
      </div>
      <Field label="Description" htmlFor={`${id}-description`}>
        <Textarea id={`${id}-description`} value={description} maxLength={500} onChange={event => setDescription(event.target.value)} />
      </Field>
      <ImageField
        label="Logo"
        realm="admin"
        purpose="brand_logo"
        targetId={brand.slug}
        value={logo}
        onChange={setLogo}
        disabled={!editable}
        hint="Square works best. Network operators (MTN, Airtel…) are brands too."
      />
      <ImageField label="Card image" realm="admin" purpose="brand_card" targetId={brand.slug} value={image} onChange={setImage} disabled={!editable} shape="wide" hint="The gift card art shown on product cards." />
      <Field label="Colour" htmlFor={`${id}-color`} error={problems.color} hint="The brand's main colour, used behind its logo.">
        <div className="flex items-center gap-2">
          <span aria-hidden className="size-11 shrink-0 rounded-lg border border-line" style={{ background: !problems.color && color.trim() ? color.trim() : "transparent" }} />
          <Input id={`${id}-color`} value={color} maxLength={7} onChange={event => setColor(event.target.value)} placeholder="#FF9900" />
        </div>
      </Field>
      <Field label="Tags" htmlFor={`${id}-tags`} hint="Comma-separated, for example gaming, streaming. Brand grids can show one tag.">
        <Input id={`${id}-tags`} value={tags} onChange={event => setTags(event.target.value)} />
      </Field>
      <Field label="Other names" htmlFor={`${id}-aliases`} hint="Comma-separated words people search with, for example PSN for PlayStation.">
        <Input id={`${id}-aliases`} value={aliases} onChange={event => setAliases(event.target.value)} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Sort order" htmlFor={`${id}-sort`} error={problems.sort} hint="Lower numbers come first.">
          <Input id={`${id}-sort`} inputMode="numeric" value={sortOrder} onChange={event => setSortOrder(event.target.value.replace(/\D/g, ""))} />
        </Field>
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3 rounded-xl bg-canvas px-4 py-3 text-sm">
            <span className="font-semibold">Featured</span>
            <Toggle label="Featured" checked={featured} onChange={setFeatured} />
          </div>
          <div className="flex items-center justify-between gap-3 rounded-xl bg-canvas px-4 py-3 text-sm">
            <span className="font-semibold">Shown on bitocard.com</span>
            <Toggle label="Shown on bitocard.com" checked={visible} onChange={setVisible} />
          </div>
        </div>
      </div>
    </fieldset>
  );

  if (!editable) {
    return (
      <Dialog open onClose={onClose} title={brand.name} description={`${brand.slug} · view only`}>
        {form}
      </Dialog>
    );
  }

  return (
    <ActionDialog
      open
      onClose={onClose}
      title={`Edit ${brand.name}`}
      description={`${brand.slug} · ${brand.products} product${brand.products === 1 ? "" : "s"}`}
      confirmLabel="Save brand"
      requireReason={false}
      onConfirm={async () => {
        const problem = Object.values(problems).find(Boolean);
        if (problem) throw new Error(problem);
        const input: BrandInput = {
          name: name.trim(),
          company: orNull(company),
          description: orNull(description),
          logo_url: orNull(logo),
          image_url: orNull(image),
          color: orNull(color),
          tags: list(tags).map(tag => tag.toLowerCase()),
          aliases: list(aliases),
          featured,
          sort_order: Number(sortOrder),
          visible,
        };
        await save({ slug: brand.slug, brand: input }).unwrap();
      }}
    >
      {form}
    </ActionDialog>
  );
}

/** Storefront Manager: how brands appear on bitocard.com. */
export default function StorefrontBrandsPage() {
  const admin = useAdmin();
  const editable = can(admin, "operations");
  const brands = useStorefrontBrandsQuery();
  const [search, setSearch] = useState("");
  const q = useDeferredValue(search.trim().toLowerCase());
  const [open, setOpen] = useState<AdminBrand | null>(null);

  const rows = brands.data?.data.filter(
    brand => !q || brand.name.toLowerCase().includes(q) || brand.slug.includes(q) || brand.tags.some(tag => tag.includes(q)) || brand.aliases.some(alias => alias.toLowerCase().includes(q)),
  );

  const columns: Array<Column<AdminBrand>> = [
    {
      key: "brand",
      header: "Brand",
      cell: brand => (
        <span className="flex min-w-0 items-center gap-3">
          <Swatch brand={brand} />
          <span className="min-w-0">
            <span className="block truncate font-semibold">{brand.name}</span>
            <span className="block truncate font-mono text-xs text-muted">{brand.slug}</span>
          </span>
        </span>
      ),
    },
    { key: "products", header: "Products", align: "right", cell: brand => brand.products.toLocaleString("en-GB") },
    { key: "categories", header: "Categories", hideOnMobile: true, cell: brand => <span className="text-sm">{brand.categories.map(category => categoryLabels[category] ?? category).join(", ") || "—"}</span> },
    {
      key: "tags",
      header: "Tags",
      hideOnMobile: true,
      cell: brand =>
        brand.tags.length ? (
          <span className="flex flex-wrap gap-1">
            {brand.tags.map(tag => (
              <Badge key={tag} dot={false}>
                {tag}
              </Badge>
            ))}
          </span>
        ) : (
          "—"
        ),
    },
    { key: "featured", header: "Featured", cell: brand => (brand.featured ? <Badge tone="pink">Featured</Badge> : <span className="text-muted">No</span>) },
    { key: "visible", header: "Shown", cell: brand => <StatusBadge status={brand.visible ? "active" : "disabled"} label={brand.visible ? "Shown" : "Hidden"} /> },
    { key: "configured", header: "Set up", hideOnMobile: true, cell: brand => (brand.configured ? <Badge tone="green">Configured</Badge> : <Badge tone="amber">Defaults</Badge>) },
  ];

  return (
    <AdminShell section="storefront" current="/storefront/brands" crumbs={[{ label: "Storefront", href: "/storefront" }, { label: "Brands" }]}>
      <PageHeader
        title="Brands"
        description="Brands are how products appear on bitocard.com: their name, logo, colour, tags and order. Visitors only ever see the brand, never BitoCard's suppliers. Brands come from the catalogue; until one is set up it uses defaults."
      />
      <label className="relative flex max-w-md items-center">
        <span className="sr-only">Search brands</span>
        <Search className="pointer-events-none absolute left-4 size-4 text-subtle" aria-hidden />
        <Input type="search" placeholder="Search by name, slug or tag…" value={search} onChange={event => setSearch(event.target.value)} className="min-h-12 rounded-2xl pl-11" />
      </label>
      <Card>
        <DataTable
          caption="Brands"
          columns={columns}
          rows={rows}
          rowKey={brand => brand.slug}
          loading={brands.isLoading}
          error={brands.error ? errorMessage(brands.error) : null}
          onRetry={brands.refetch}
          onRowClick={setOpen}
          empty={q ? "No brands match." : "No brands yet. Brands appear once a supplier's catalogue is synced."}
        />
      </Card>
      {open ? <BrandDialog key={open.slug} brand={open} editable={editable} onClose={() => setOpen(null)} /> : null}
    </AdminShell>
  );
}
