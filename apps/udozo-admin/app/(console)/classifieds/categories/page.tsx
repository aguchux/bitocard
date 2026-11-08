"use client";

import { useState, type FormEvent } from "react";
import { Badge, Button, Card, errorMessage, formatNumber, ImageField, Input, Notice, PageHeader, QueryView, Skeleton, Toggle } from "@bitocard/admin-ui";
import { can, useAdmin } from "@bitocard/admin-ui/shell";
import { UdozoShell } from "@/components/shell";
import {
  type AdminClassifiedCategory,
  useClassifiedCategoriesQuery,
  useSetClassifiedCategoryCountryMutation,
  useSetClassifiedCategoryKeywordsMutation,
  useSetClassifiedCategoryMutation,
  useSetClassifiedCategoryPicturesMutation,
  useSetClassifiedCategorySkuPrefixMutation,
} from "@bitocard/api-client/admin";
import { MarketFilter } from "@/components/classifieds";
import { textWords, wordsText } from "@/components/category-words";

/**
 * Udozo > Categories: which categories are open in each market (closing a top category closes its
 * subcategories there), and switching one off everywhere. Closing stops new ads; live ones stay until they end.
 * Each category's SKU prefix starts its ads' SKUs (PHN-000123), and its search words (what people call the things
 * sold there) send "carpet" or "plastic chairs" to the right subcategory on Post an ad, in search suggestions and in
 * the assistants. A top category also has its own pictures on udozo.com: a banner across the top of its pages and a
 * spotlight image drawn on a circle beside its name. Operations change them (switches shown at once, undone if
 * refused); each change is audited.
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
      <PageHeader title="Categories" description="What sellers can post in each market. Closing a category stops new ads in it; ads already live stay until they end or are removed. Each category's three letters start its ads' SKUs, and its search words send what people type to it." />
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
  const [pictures, setPictures] = useState(false);
  return (
    <>
      <div className={top ? "flex flex-wrap items-center gap-3 px-5 py-4 sm:px-6" : "flex flex-wrap items-center gap-3 py-2.5 pl-10 pr-5 sm:pr-6"}>
      <span className="min-w-0 flex-1">
        <span className={top ? "block font-semibold text-ink" : "block text-sm text-ink"}>{category.name}</span>
        <span className="block text-xs text-muted">
          {formatNumber(category.active_listings)} live ads{category.b2b ? " · for businesses" : ""}
        </span>
      </span>
      {!category.enabled ? <Badge tone="grey">Off everywhere</Badge> : null}
      {top ? <PicturesButton category={category} open={pictures} onToggle={() => setPictures(shown => !shown)} /> : null}
      <SkuPrefix category={category} changes={changes} />
      {top ? null : <SearchWords category={category} changes={changes} />}
      <span className="flex items-center gap-2 text-xs font-semibold text-muted">
        Open in {country}
        <Toggle label={`${category.name}: open in ${country}`} checked={category.open} disabled={!changes} onChange={onOpen} />
      </span>
      <span className="flex items-center gap-2 text-xs font-semibold text-muted">
        On everywhere
        <Toggle label={`${category.name}: on everywhere`} checked={category.enabled} disabled={!changes} onChange={onEnable} />
      </span>
      </div>
      {top && pictures ? <CategoryPictures category={category} changes={changes} /> : null}
    </>
  );
}

/** What a top category's pictures are, opening their editor. */
function PicturesButton({ category, open, onToggle }: { category: AdminClassifiedCategory; open: boolean; onToggle: () => void }) {
  const count = [category.banner_url, category.spotlight_url].filter(Boolean).length;
  const label = count === 2 ? "Banner and spotlight" : category.banner_url ? "Banner, no spotlight" : category.spotlight_url ? "Spotlight, no banner" : "No pictures";
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-label={`${category.name}: ${label}, ${open ? "close" : "open"} the pictures`}
      className={`rounded-lg border px-2 py-1 text-xs font-semibold hover:border-brand-400 hover:text-brand-600 ${count ? "border-line bg-white text-ink" : "border-amber-300 bg-amber-50 text-amber-900"}`}
    >
      {label}
    </button>
  );
}

/**
 * A top category's pictures on udozo.com, each saved as soon as it is uploaded or removed: the banner across the top of
 * its pages (and its subcategories'), and the spotlight image beside its name, with a preview of the two together.
 */
function CategoryPictures({ category, changes }: { category: AdminClassifiedCategory; changes: boolean }) {
  const [save, saving] = useSetClassifiedCategoryPicturesMutation();
  const [saved, setSaved] = useState<string | null>(null);
  const banner = category.banner_url ?? "";
  const spotlight = category.spotlight_url ?? "";
  const change = async (field: "banner_url" | "spotlight_url", url: string) => {
    setSaved(null);
    try {
      await save({ id: category.id, [field]: url.trim() || null }).unwrap();
      const what = field === "banner_url" ? "banner" : "spotlight image";
      setSaved(url ? `The ${what} is saved. It shows on udozo.com within a few minutes.` : `The ${what} is taken off.`);
    } catch {
      // The API's message shows below (the mutation's error).
    }
  };
  return (
    <div className="grid gap-4 border-t border-line bg-canvas/60 px-5 py-4 sm:px-6 lg:grid-cols-2">
      <fieldset disabled={!changes} className="grid min-w-0 content-start gap-4">
        <ImageField
          label="Banner"
          realm="admin"
          purpose="classified_category_banner"
          targetId={category.slug}
          shape="wide"
          value={banner}
          onChange={url => void change("banner_url", url)}
          hint="Across the top of its category pages on udozo.com, its subcategories' too. Best 1600 × 400 pixels (4:1), at least 600 × 150; JPEG, PNG or WebP up to 3 MB. Keep the left side calm: the name is written there. Remove it for Udozo's drawn banner."
        />
        <ImageField
          label="Spotlight image"
          realm="admin"
          purpose="classified_category_spotlight"
          targetId={category.slug}
          value={spotlight}
          onChange={url => void change("spotlight_url", url)}
          hint="A cut-out of what is sold here (phones and a tablet, a fridge and a cooker) on a clear background, drawn on a circle beside the name. Square, best 800 × 800 pixels; PNG or WebP with transparency, up to 2 MB. Remove it to show the category's icon instead."
        />
        {saving.error ? <Notice tone="red">{errorMessage(saving.error)}</Notice> : saved ? <p className="text-sm text-muted">{saved}</p> : null}
      </fieldset>
      <div className="grid min-w-0 content-start gap-2">
        <span className="text-xs font-semibold text-muted">How it looks on udozo.com</span>
        <div role="img" aria-label={`${category.name}: preview of its banner and spotlight image`} className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#10212e] via-[#185174] to-[#0e7cc0]">
          {/* eslint-disable-next-line @next/next/no-img-element -- an admin's checked upload on the media CDN. */}
          {banner ? <img src={banner} alt="" className="absolute inset-0 size-full object-cover" /> : null}
          <span className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/30 to-transparent" />
          <div className="relative flex min-h-36 items-center justify-between gap-3 p-4">
            <span className="grid gap-1">
              <span className="text-lg font-extrabold text-white">{category.name}</span>
              <span className="text-xs text-white/80">{formatNumber(category.active_listings)} live ads</span>
            </span>
            <span className="grid size-28 shrink-0 place-items-center overflow-hidden rounded-full bg-white/90 ring-4 ring-white/30">
              {/* eslint-disable-next-line @next/next/no-img-element -- an admin's checked upload on the media CDN. */}
              {spotlight ? <img src={spotlight} alt="" className="size-[88%] object-contain" /> : <span className="text-xs text-muted">Its icon</span>}
            </span>
          </div>
        </div>
      </div>
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

/**
 * A subcategory's search words: what people call the things sold there, matched as typed. Shown as a count; operations
 * edit them one a line (or separated by commas). Singular is enough: "plastic chairs" holds "plastic chair".
 */
function SearchWords({ category, changes }: { category: AdminClassifiedCategory; changes: boolean }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [save, saving] = useSetClassifiedCategoryKeywordsMutation();
  const [error, setError] = useState<string | null>(null);
  const saved = category.keywords ?? [];
  const words = textWords(value);
  const tooMany = words.length > 60;
  const tooLong = words.some(word => word.length > 40);
  const count = saved.length;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (tooMany || tooLong) return;
    setError(null);
    try {
      await save({ id: category.id, keywords: words }).unwrap();
      setEditing(false);
    } catch (problem) {
      setError(errorMessage(problem));
    }
  };
  const label = count ? `${count} search word${count === 1 ? "" : "s"}` : "No search words";
  if (!editing) {
    return changes ? (
      <button
        type="button"
        onClick={() => (setValue(wordsText(saved)), setError(null), setEditing(true))}
        aria-label={`${category.name}: ${label}, change them`}
        title={saved.slice(0, 12).join(", ")}
        className={`rounded-lg border px-2 py-1 text-xs font-semibold hover:border-brand-400 hover:text-brand-600 ${count ? "border-line bg-white text-ink" : "border-amber-300 bg-amber-50 text-amber-900"}`}
      >
        {label}
      </button>
    ) : (
      <span title={saved.slice(0, 12).join(", ")} className="rounded-lg bg-canvas px-2 py-1 text-xs font-semibold text-ink">
        {label}
      </span>
    );
  }
  return (
    <form onSubmit={submit} className="grid w-full gap-2">
      <label className="text-xs font-semibold text-muted" htmlFor={`words-${category.id}`}>
        {category.name}: search words, one a line
      </label>
      <textarea
        id={`words-${category.id}`}
        value={value}
        rows={6}
        autoFocus
        onChange={event => setValue(event.target.value)}
        onKeyDown={event => event.key === "Escape" && setEditing(false)}
        aria-invalid={tooMany || tooLong}
        className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink focus:border-brand-400 focus:outline-none"
      />
      <span className="text-xs text-muted">
        {error ?? (tooMany ? `At most 60 words (${words.length} now).` : tooLong ? "Each word at most 40 characters." : `${words.length} words. What people call the things sold here; singular is enough ("plastic chair" also finds "plastic chairs").`)}
      </span>
      <span className="flex gap-2">
        <Button type="submit" size="sm" loading={saving.isLoading} disabled={tooMany || tooLong || wordsText(words) === wordsText(saved)}>
          Save
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </span>
    </form>
  );
}
