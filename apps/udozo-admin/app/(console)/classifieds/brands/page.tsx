"use client";

import { useId, useMemo, useState, type FormEvent } from "react";
import { AppLink } from "@bitocard/admin-ui/shell";
import { Badge, Button, Card, CardHeader, DataTable, errorMessage, Field, formatNumber, formatRelative, ImageField, Input, Notice, PageHeader, QueryView, Select, Skeleton, useDebouncedValue, type Column } from "@bitocard/admin-ui";
import { can, useAdmin } from "@bitocard/admin-ui/shell";
import { BrandLogo } from "@/components/brand-logo";
import { UdozoShell } from "@/components/shell";
import {
  type AdminClassifiedBrand,
  type AdminClassifiedCategoryTop,
  type ClassifiedBrandsFilter,
  useClassifiedBrandsQuery,
  useClassifiedBrandSuggestionsQuery,
  useClassifiedCategoriesQuery,
  useClassifiedModelSuggestionsQuery,
  useCreateClassifiedBrandMutation,
  useCreateClassifiedModelMutation,
  useDismissClassifiedBrandSuggestionMutation,
  useDismissClassifiedModelSuggestionMutation,
  useUpdateClassifiedBrandMutation,
} from "@bitocard/api-client/admin";

const perPage = 50;
const list = (value: string) => value.split(/[\n,]/).map(item => item.trim()).filter(Boolean);
const hex = /^#[0-9a-fA-F]{6}$/;

type Editing = { mode: "new"; name?: string; categoryIds?: string[] } | { mode: "edit"; brand: AdminClassifiedBrand };

/**
 * Marketplace > Brand registry: the brands sellers pick when they post an ad (each in the categories it sells in, with
 * the words sellers type for it, its logo and colour) and the brands sellers typed that it lacks. Adding a brand turns
 * the ads already typed with it into it; renaming one keeps the old name as a search word and the ads follow.
 * Support reads; operations change.
 */
export default function ClassifiedBrandsPage() {
  const admin = useAdmin();
  const changes = can(admin, "operations");
  const [words, setWords] = useState("");
  const q = useDebouncedValue(words.trim());
  const [category, setCategory] = useState("");
  const [logo, setLogo] = useState<"" | "missing" | "bundled" | "uploaded">("");
  const [offset, setOffset] = useState(0);
  const filter: ClassifiedBrandsFilter = { ...(q ? { q } : {}), ...(category ? { category } : {}), ...(logo ? { logo } : {}), offset, limit: perPage };
  const brands = useClassifiedBrandsQuery(filter);
  const categories = useClassifiedCategoriesQuery("NG");
  const tree = categories.data?.data ?? [];
  const [editing, setEditing] = useState<Editing | null>(null);
  const total = brands.data?.total ?? 0;

  const columns: Array<Column<AdminClassifiedBrand>> = [
    {
      key: "name",
      header: "Brand",
      cell: item => (
        <button type="button" className="flex min-w-0 items-center gap-3 text-left" onClick={() => setEditing({ mode: "edit", brand: item })}>
          <BrandLogo brand={item} />
          <span className="min-w-0">
            <span className="block font-semibold text-ink hover:underline">{item.name}</span>
            <span className="block truncate text-xs text-muted">{item.aliases.length ? item.aliases.join(", ") : item.slug}</span>
          </span>
        </button>
      ),
    },
    {
      key: "categories",
      header: "Sold in",
      hideOnMobile: true,
      cell: item => <span className="block max-w-64 text-sm text-muted">{item.categories.length > 3 ? `${item.categories.slice(0, 2).map(link => link.name).join(", ")} and ${item.categories.length - 2} more` : item.categories.map(link => link.name).join(", ") || "No category"}</span>,
    },
    { key: "ads", header: "Live ads", hideOnMobile: true, cell: item => formatNumber(item.listings) },
    {
      key: "models",
      header: "Models",
      cell: item => (
        <AppLink href={`/classifieds/brands/${item.slug}`} className="text-sm font-semibold text-ink hover:underline">
          {formatNumber(item.models)}
        </AppLink>
      ),
    },
    {
      key: "logo",
      header: "Logo",
      cell: item => (
        <span className="flex flex-wrap gap-1">
          {item.logo_source === "uploaded" ? <Badge tone="blue">Uploaded</Badge> : item.logo_source === "bundled" ? <Badge tone="green">Bundled</Badge> : <Badge tone="amber">Initials</Badge>}
          {item.enabled ? null : <Badge tone="grey">Off</Badge>}
        </span>
      ),
    },
  ];

  const reset = () => setOffset(0);
  return (
    <UdozoShell section="marketplace" current="/classifieds/brands" crumbs={[{ label: "Marketplace", href: "/classifieds" }, { label: "Brand registry" }]}>
      <PageHeader
        title="Brand registry"
        description="The brands sellers choose from when they post an ad, with their logos. Buyers filter by them in every category that asks for a brand."
        actions={changes ? <Button onClick={() => setEditing({ mode: "new" })}>New brand</Button> : null}
      />
      <div className="mt-6 grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Card>
          <div className="grid gap-3 border-b border-line px-5 py-3 sm:grid-cols-[minmax(0,1fr)_200px_160px] sm:px-6">
            <label>
              <span className="sr-only">Search brands</span>
              <Input
                type="search"
                placeholder="Search names and search words"
                value={words}
                onChange={event => {
                  setWords(event.target.value);
                  reset();
                }}
              />
            </label>
            <label>
              <span className="sr-only">Category</span>
              <Select
                value={category}
                onChange={event => {
                  setCategory(event.target.value);
                  reset();
                }}
              >
                <option value="">Every category</option>
                {tree.map(top => (
                  <optgroup key={top.slug} label={top.name}>
                    <option value={top.slug}>All of {top.name}</option>
                    {top.children.map(child => (
                      <option key={child.slug} value={child.slug}>
                        {child.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </Select>
            </label>
            <label>
              <span className="sr-only">Logo</span>
              <Select
                value={logo}
                onChange={event => {
                  setLogo(event.target.value as typeof logo);
                  reset();
                }}
              >
                <option value="">Any logo</option>
                <option value="missing">No logo</option>
                <option value="bundled">Bundled logo</option>
                <option value="uploaded">Uploaded logo</option>
              </Select>
            </label>
          </div>
          <DataTable columns={columns} rows={brands.data?.data} rowKey={item => item.slug} loading={brands.isLoading} error={brands.error ? errorMessage(brands.error) : null} onRetry={brands.refetch} empty="No brands match." />
          {total > perPage ? (
            <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3 text-sm text-muted sm:px-6">
              <span>
                {formatNumber(offset + 1)}–{formatNumber(Math.min(offset + perPage, total))} of {formatNumber(total)}
              </span>
              <span className="flex gap-2">
                <Button size="sm" variant="secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - perPage))}>
                  Previous
                </Button>
                <Button size="sm" variant="secondary" disabled={offset + perPage >= total} onClick={() => setOffset(offset + perPage)}>
                  Next
                </Button>
              </span>
            </div>
          ) : null}
        </Card>
        <div className="space-y-6">
          {editing ? (
            <BrandEditor key={editing.mode === "edit" ? editing.brand.slug : `new:${editing.name ?? ""}`} editing={editing} tree={tree} changes={changes} onDone={setEditing} />
          ) : (
            <Card>
              <CardHeader title="Choose a brand" description="Open one from the list to change it, or add a new one." />
            </Card>
          )}
          <Suggestions changes={changes} onAdd={(name, categoryIds) => setEditing({ mode: "new", name, categoryIds })} />
          <ModelSuggestions changes={changes} />
        </div>
      </div>
    </UdozoShell>
  );
}

function BrandEditor({ editing, tree, changes, onDone }: { editing: Editing; tree: AdminClassifiedCategoryTop[]; changes: boolean; onDone: (next: Editing | null) => void }) {
  const id = useId();
  const current = editing.mode === "edit" ? editing.brand : null;
  const [name, setName] = useState(current?.name ?? (editing.mode === "new" ? (editing.name ?? "") : ""));
  const [aliases, setAliases] = useState((current?.aliases ?? []).join(", "));
  const [color, setColor] = useState(current?.color ?? "");
  const [logoUrl, setLogoUrl] = useState(current?.uploaded_logo_url ?? "");
  const [bannerUrl, setBannerUrl] = useState(current?.banner_url ?? "");
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(current ? current.categories.map(link => link.id) : editing.mode === "new" ? (editing.categoryIds ?? []) : []));
  const [find, setFind] = useState("");
  const [create, creating] = useCreateClassifiedBrandMutation();
  const [update, updating] = useUpdateClassifiedBrandMutation();
  const [saved, setSaved] = useState<string | null>(null);
  const error = creating.error ?? updating.error;
  const problems = [name.trim().length < 1 ? "Name the brand." : null, color.trim() && !hex.test(color.trim()) ? "The colour is # and six digits or letters, for example #1428A0." : null].filter(Boolean) as string[];

  const shownTree = useMemo(() => {
    const words = find.trim().toLowerCase();
    return tree
      .map(top => ({ ...top, children: top.children.filter(child => !words || child.name.toLowerCase().includes(words) || top.name.toLowerCase().includes(words) || chosen.has(child.id)) }))
      .filter(top => top.children.length);
  }, [tree, find, chosen]);

  const preview = { slug: current?.slug ?? (name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "new"), name: name.trim() || "Brand", logo_url: logoUrl.trim() || current?.bundled_logo_url || null, color: hex.test(color.trim()) ? color.trim().toUpperCase() : null };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (problems.length) return;
    setSaved(null);
    const fields = { name: name.trim(), aliases: list(aliases), color: color.trim() ? color.trim().toUpperCase() : null, category_ids: [...chosen] };
    const result = current ? await update({ slug: current.slug, ...fields, logo_url: logoUrl.trim() || null, banner_url: bannerUrl.trim() || null }).unwrap() : await create(fields).unwrap();
    onDone({ mode: "edit", brand: result });
    setSaved(result.listings_renamed ? `Saved. ${formatNumber(result.listings_renamed)} ${result.listings_renamed === 1 ? "ad now reads" : "ads now read"} “${result.name}”.` : "Saved.");
  };

  // An uploaded (or removed) logo or banner is saved at once, on its own: nothing else on the form changes with it.
  const savePicture = async (field: "logo_url" | "banner_url", url: string) => {
    (field === "logo_url" ? setLogoUrl : setBannerUrl)(url);
    if (!current) return;
    setSaved(null);
    try {
      const result = await update({ slug: current.slug, [field]: url.trim() || null }).unwrap();
      onDone({ mode: "edit", brand: result });
      const what = field === "logo_url" ? "logo" : "banner";
      setSaved(url ? `The ${what} is saved. It shows on udozo.com within a few minutes.` : `The ${what} is taken off.`);
    } catch {
      // The API's message shows below (the mutation's error).
    }
  };

  const toggleEnabled = async () => {
    if (!current) return;
    onDone({ mode: "edit", brand: await update({ slug: current.slug, enabled: !current.enabled }).unwrap() });
  };

  const toggleCategory = (categoryId: string) =>
    setChosen(previous => {
      const next = new Set(previous);
      if (next.has(categoryId)) next.delete(categoryId);
      else next.add(categoryId);
      return next;
    });

  return (
    <Card>
      <CardHeader title={current ? current.name : "New brand"} description={current ? `${formatNumber(current.listings)} live ads. Its address (${current.slug}) stays as it is.` : "Sellers can choose it as soon as it is saved."} />
      <form onSubmit={submit} className="space-y-4 px-5 pb-5 sm:px-6">
        <fieldset disabled={!changes} className="space-y-4">
          <div className="flex items-center gap-3 rounded-xl bg-canvas p-3">
            <BrandLogo brand={preview} size="lg" />
            <p className="text-sm text-muted">{logoUrl.trim() ? "Its uploaded logo." : current?.bundled_logo_url ? "The logo bundled with udozo.com (Simple Icons)." : "Its initials on its colour, until it has a logo."}</p>
          </div>
          <Field label="Name" htmlFor={`${id}-name`} hint={current ? "A new name keeps the old one as a search word, and ads follow it." : undefined}>
            <Input id={`${id}-name`} maxLength={60} value={name} onChange={event => setName(event.target.value)} />
          </Field>
          <Field label="Search words" htmlFor={`${id}-aliases`} hint="Separated by commas: what sellers type instead (model lines, short names, other spellings).">
            <Input id={`${id}-aliases`} value={aliases} onChange={event => setAliases(event.target.value)} placeholder="iphone, ipad, macbook" />
          </Field>
          <Field label="Colour" htmlFor={`${id}-color`} hint="Behind its initials when it has no logo. Blank for Udozo's choice.">
            <span className="flex items-center gap-2">
              <input type="color" aria-label="Pick the colour" value={hex.test(color.trim()) ? color.trim() : "#1F2937"} onChange={event => setColor(event.target.value.toUpperCase())} className="h-10 w-12 shrink-0 cursor-pointer rounded-lg border border-line bg-white p-1" />
              <Input id={`${id}-color`} className="font-mono" maxLength={7} value={color} onChange={event => setColor(event.target.value)} placeholder="#1428A0" />
            </span>
          </Field>
          {current ? (
            <ImageField label="Logo" realm="admin" purpose="classified_brand_logo" targetId={current.slug} value={logoUrl} onChange={url => void savePicture("logo_url", url)} hint="Square SVG or PNG, the full-colour logo on a clear background. Saved as soon as it is uploaded; remove it to go back to the bundled one." />
          ) : (
            <p className="text-sm text-muted">Save the brand first, then upload its logo and banner.</p>
          )}
          {current ? (
            <ImageField
              label="Banner"
              realm="admin"
              purpose="classified_brand_banner"
              targetId={current.slug}
              value={bannerUrl}
              onChange={url => void savePicture("banner_url", url)}
              hint="Across the top of its brand pages on udozo.com, saved as soon as it is uploaded. Best 1600 × 400 pixels (4:1), at least 600 × 150; JPEG, PNG or WebP up to 3 MB. Keep words and faces in the middle: phones show less of the sides. Remove it to go back to Udozo's drawn banner."
            />
          ) : null}
          {current ? (
            <AppLink href={`/classifieds/brands/${current.slug}`} className="block text-sm font-semibold text-ink hover:underline">
              {formatNumber(current.models)} {current.models === 1 ? "model" : "models"}: see and change them
            </AppLink>
          ) : null}
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold text-ink">
              Sold in <span className="font-normal text-muted">({chosen.size})</span>
            </legend>
            <Input type="search" aria-label="Find a category" placeholder="Find a category" value={find} onChange={event => setFind(event.target.value)} />
            <div className="max-h-72 space-y-3 overflow-y-auto rounded-xl border border-line p-3">
              {shownTree.length ? (
                shownTree.map(top => (
                  <div key={top.id}>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted">{top.name}</p>
                    <ul className="mt-1 grid gap-1 sm:grid-cols-2">
                      {top.children.map(child => (
                        <li key={child.id}>
                          <label className="flex min-h-9 items-center gap-2 text-sm text-ink">
                            <input type="checkbox" checked={chosen.has(child.id)} onChange={() => toggleCategory(child.id)} className="size-4 accent-navy-900" />
                            {child.name}
                          </label>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted">No category matches.</p>
              )}
            </div>
          </fieldset>
        </fieldset>
        {problems.length && changes ? (
          <ul className="list-disc pl-4 text-sm text-red-700">
            {problems.map(problem => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        ) : null}
        {error ? <Notice tone="red">{errorMessage(error)}</Notice> : null}
        {saved ? <Notice tone="green">{saved}</Notice> : null}
        {changes ? (
          <div className="flex flex-wrap justify-end gap-2">
            {current ? (
              <Button type="button" variant="secondary" loading={updating.isLoading && updating.originalArgs?.enabled !== undefined} onClick={() => void toggleEnabled()}>
                {current.enabled ? "Turn off" : "Turn on"}
              </Button>
            ) : (
              <Button type="button" variant="ghost" onClick={() => onDone(null)}>
                Cancel
              </Button>
            )}
            <Button type="submit" loading={creating.isLoading || (updating.isLoading && updating.originalArgs?.enabled === undefined)} disabled={problems.length > 0}>
              {current ? "Save" : "Add brand"}
            </Button>
          </div>
        ) : null}
      </form>
    </Card>
  );
}

function Suggestions({ changes, onAdd }: { changes: boolean; onAdd: (name: string, categoryIds: string[]) => void }) {
  const suggestions = useClassifiedBrandSuggestionsQuery();
  const [dismiss, dismissing] = useDismissClassifiedBrandSuggestionMutation();
  return (
    <Card>
      <CardHeader title={`New brands from sellers${suggestions.data?.data.length ? ` (${suggestions.data.data.length})` : ""}`} description="Brands sellers typed that the registry does not have, most sellers first. Adding one turns their ads into it." />
      <div className="px-5 pb-5 sm:px-6">
        {dismissing.error ? <Notice tone="red">{errorMessage(dismissing.error)}</Notice> : null}
        <QueryView query={suggestions} loading={<Skeleton className="h-24 w-full" />}>
          {data =>
            data.data.length ? (
              <ul className="divide-y divide-line">
                {data.data.map(item => (
                  <li key={item.name_key} className="flex flex-wrap items-center gap-2 py-2.5">
                    <span className="min-w-0 flex-1 text-sm">
                      <span className="font-semibold text-ink">{item.name}</span>
                      <span className="text-muted">
                        {" "}
                        · {item.sellers} {item.sellers === 1 ? "seller" : "sellers"}
                        {item.categories.length ? ` · ${item.categories.map(link => link.name).join(", ")}` : ""}
                      </span>
                      <span className="block text-xs text-muted">Last typed {formatRelative(item.last_at)}</span>
                    </span>
                    {changes ? (
                      <span className="flex gap-2">
                        <Button size="sm" variant="ghost" loading={dismissing.isLoading && dismissing.originalArgs === item.name_key} onClick={() => void dismiss(item.name_key)}>
                          Dismiss
                        </Button>
                        <Button size="sm" onClick={() => onAdd(item.name, item.categories.map(link => link.id))}>
                          Add
                        </Button>
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">No new brands waiting.</p>
            )
          }
        </QueryView>
      </div>
    </Card>
  );
}

function ModelSuggestions({ changes }: { changes: boolean }) {
  const suggestions = useClassifiedModelSuggestionsQuery();
  const [add, adding] = useCreateClassifiedModelMutation();
  const [dismiss, dismissing] = useDismissClassifiedModelSuggestionMutation();
  const error = adding.error ?? dismissing.error;
  const learnFrom = suggestions.data?.learn_from ?? 3;
  return (
    <Card>
      <CardHeader title={`New models from sellers${suggestions.data?.data.length ? ` (${suggestions.data.data.length})` : ""}`} description={`Models sellers typed that a brand's list lacks. One joins by itself once ${learnFrom} different sellers typed it; add it sooner, or dismiss it to keep it out.`} />
      <div className="px-5 pb-5 sm:px-6">
        {error ? <Notice tone="red">{errorMessage(error)}</Notice> : null}
        <QueryView query={suggestions} loading={<Skeleton className="h-24 w-full" />}>
          {data =>
            data.data.length ? (
              <ul className="divide-y divide-line">
                {data.data.map(item => (
                  <li key={`${item.brand.id}:${item.category.id}:${item.name_key}`} className="flex flex-wrap items-center gap-2 py-2.5">
                    <span className="min-w-0 flex-1 text-sm">
                      <span className="font-semibold text-ink">
                        {item.brand.name} {item.name}
                      </span>
                      <span className="text-muted">
                        {" "}
                        · {item.sellers} {item.sellers === 1 ? "seller" : "sellers"} · {item.category.name}
                      </span>
                      <span className="block text-xs text-muted">Last typed {formatRelative(item.last_at)}</span>
                    </span>
                    {changes ? (
                      <span className="flex gap-2">
                        <Button size="sm" variant="ghost" onClick={() => void dismiss({ brand_id: item.brand.id, category_id: item.category.id, name_key: item.name_key })}>
                          Dismiss
                        </Button>
                        <Button size="sm" onClick={() => void add({ slug: item.brand.slug, name: item.name, category_id: item.category.id })}>
                          Add
                        </Button>
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">No new models waiting.</p>
            )
          }
        </QueryView>
      </div>
    </Card>
  );
}
