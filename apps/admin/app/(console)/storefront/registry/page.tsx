"use client";

import { useDeferredValue, useState } from "react";
import { Search } from "lucide-react";
import { Badge, Button, Card, Dialog, EmptyState, ErrorState, errorMessage, ImageField, Input, Notice, PageHeader, Skeleton, Tabs } from "@bitocard/admin-ui";
import { AdminShell, can, useAdmin } from "@bitocard/admin-ui/shell";
import { type BrandRegistryEntry, useBrandRegistryQuery, useSaveBrandRegistryMutation } from "@bitocard/api-client/admin";

type Filter = "all" | "missing" | "done";

/** Dark text on light brand colours, white on dark ones, as the store shows initials. */
function inkOn(color: string) {
  const [r, g, b] = [1, 3, 5].map(at => parseInt(color.slice(at, at + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.6 ? "#070f4c" : "#ffffff";
}

/** The logo on a white tile, or the initials on the brand colour (what the store shows without a logo). */
function Mark({ entry, size = "size-14" }: { entry: BrandRegistryEntry; size?: string }) {
  if (entry.logo_url) {
    // eslint-disable-next-line @next/next/no-img-element -- uploaded logos on the storage CDN, or registry addresses
    return <img src={entry.logo_url} alt="" className={`${size} shrink-0 rounded-xl border border-line bg-white object-contain p-1.5`} />;
  }
  return (
    <span aria-hidden className={`${size} grid shrink-0 place-items-center rounded-xl text-sm font-extrabold`} style={{ background: entry.color, color: inkOn(entry.color) }}>
      {entry.initials}
    </span>
  );
}

const sourceLabel = { upload: "Uploaded", file: "From the registry file", bundled: "Bundled icon" } as const;

function EntryDialog({ entry, editable, onClose }: { entry: BrandRegistryEntry; editable: boolean; onClose: () => void }) {
  const [save, state] = useSaveBrandRegistryMutation();
  // Only uploaded values are edited here; a logo from the registry file shows until one is uploaded.
  const [logo, setLogo] = useState(entry.logo_source === "upload" ? (entry.logo_url ?? "") : "");
  const [card, setCard] = useState(entry.card_source === "upload" ? (entry.card_url ?? "") : "");
  const [saved, setSaved] = useState(false);
  const changes: { logo_url?: string | null; card_url?: string | null } = {};
  if (logo.trim() !== (entry.logo_source === "upload" ? (entry.logo_url ?? "") : "")) changes.logo_url = logo.trim() || null;
  if (card.trim() !== (entry.card_source === "upload" ? (entry.card_url ?? "") : "")) changes.card_url = card.trim() || null;
  const valid = [logo, card].every(value => !value.trim() || value.trim().startsWith("https://"));

  return (
    <Dialog
      open
      onClose={onClose}
      title={entry.name}
      description={`${entry.company ?? "Brand registry"} · ${entry.products.toLocaleString("en-GB")} product${entry.products === 1 ? "" : "s"}`}
      footer={
        editable ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
            <Button
              disabled={!Object.keys(changes).length || !valid}
              loading={state.isLoading}
              onClick={async () => {
                setSaved(false);
                if (await save({ slug: entry.slug, ...changes }).unwrap().catch(() => null)) setSaved(true);
              }}
            >
              Save
            </Button>
          </div>
        ) : undefined
      }
    >
      <div className="space-y-5">
        <div className="flex items-center gap-3 rounded-xl bg-canvas p-3">
          <Mark entry={{ ...entry, logo_url: logo.trim() && logo.trim().startsWith("https://") ? logo.trim() : entry.logo_source === "file" || entry.logo_source === "bundled" ? entry.logo_url : null }} />
          <div className="min-w-0 text-sm">
            <p className="font-semibold">On the store</p>
            <p className="text-muted">Without a logo the store shows {entry.initials} on the brand colour.</p>
          </div>
        </div>
        {state.error ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
        {saved && !Object.keys(changes).length ? <Notice tone="green">Saved. Stores show it within a minute.</Notice> : null}
        {entry.logo_source === "file" ? <Notice tone="blue">A logo is set in the registry file. An upload here replaces it.</Notice> : null}
        {entry.logo_source === "bundled" ? <Notice tone="blue">The bundled icon is shown until you upload a logo. An upload here replaces it.</Notice> : null}
        <ImageField
          label="Logo or icon"
          realm="admin"
          purpose="registry_logo"
          targetId={entry.slug}
          value={logo}
          onChange={setLogo}
          disabled={!editable}
          hint="Square, PNG or SVG, on a transparent background."
        />
        {entry.card_source === "bundled" || entry.card_source === "file" ? (
          <div className="flex items-center gap-3 rounded-xl bg-canvas p-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- the store's bundled card art */}
            <img src={entry.card_url!} alt={`${entry.name} card`} className="h-16 w-26 shrink-0 rounded-lg border border-line bg-white object-cover" loading="lazy" />
            <p className="text-sm text-muted">
              {entry.card_source === "bundled" ? "The bundled card art is shown on stores and to resellers until you upload a card image." : "Card art is set in the registry file."} An upload here replaces it.
            </p>
          </div>
        ) : null}
        <ImageField label="Card image" realm="admin" purpose="registry_card" targetId={entry.slug} value={card} onChange={setCard} disabled={!editable} shape="wide" hint="Optional gift card art for product cards." />
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="font-semibold">Product brands covered</dt>
            <dd className="mt-1 flex flex-wrap gap-1">
              {entry.slugs.map(slug => (
                <Badge key={slug} dot={false}>
                  {slug}
                </Badge>
              ))}
            </dd>
          </div>
          <div>
            <dt className="font-semibold">Colour</dt>
            <dd className="mt-1 flex items-center gap-2 font-mono">
              <span aria-hidden className="size-5 rounded border border-line" style={{ background: entry.color }} />
              {entry.color}
            </dd>
          </div>
          {entry.aliases.length ? (
            <div className="sm:col-span-2">
              <dt className="font-semibold">Search words</dt>
              <dd className="mt-1 text-muted">{entry.aliases.join(", ")}</dd>
            </div>
          ) : null}
        </dl>
        <p className="text-xs text-muted">Names, colours and search words come from brand-registry.json in the API. A brand set up under Storefront &gt; Brands keeps its own logo.</p>
      </div>
    </Dialog>
  );
}

/** Storefront Manager: logos and card art for every brand in the brand registry. */
export default function BrandRegistryPage() {
  const admin = useAdmin();
  const editable = can(admin, "operations");
  const registry = useBrandRegistryQuery();
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const q = useDeferredValue(search.trim().toLowerCase());
  const [open, setOpen] = useState<string | null>(null);
  const entries = registry.data?.data ?? [];
  const missing = entries.filter(entry => !entry.logo_url).length;
  const rows = entries
    .filter(entry => (filter === "missing" ? !entry.logo_url : filter === "done" ? Boolean(entry.logo_url) : true))
    .filter(entry => !q || [entry.name, entry.company ?? "", ...entry.slugs, ...entry.aliases, ...entry.tags].some(text => text.toLowerCase().includes(q)));
  const current = entries.find(entry => entry.slug === open) ?? null;

  return (
    <AdminShell section="storefront" current="/storefront/registry" crumbs={[{ label: "Storefront", href: "/storefront" }, { label: "Brand registry" }]}>
      <PageHeader
        title="Brand registry"
        description="Logos and card art for well-known brands such as MTN, Airtel, Amazon and Google Play. One upload covers every product of the brand, on bitocard.com and every reseller store. Brands without a logo show their initials."
      />
      <div className="flex flex-wrap items-center gap-3">
        <Tabs
          label="Show"
          value={filter}
          onChange={setFilter}
          items={[
            { value: "all", label: "All", count: entries.length },
            { value: "missing", label: "Missing a logo", count: missing },
            { value: "done", label: "With a logo", count: entries.length - missing },
          ]}
        />
        <label className="relative flex min-w-56 flex-1 items-center">
          <span className="sr-only">Search the registry</span>
          <Search className="pointer-events-none absolute left-4 size-4 text-subtle" aria-hidden />
          <Input type="search" placeholder="Search by brand, company, slug or tag…" value={search} onChange={event => setSearch(event.target.value)} className="min-h-12 rounded-2xl pl-11" />
        </label>
      </div>
      {registry.error ? (
        <Card>
          <ErrorState message={errorMessage(registry.error)} onRetry={registry.refetch} />
        </Card>
      ) : registry.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : !rows.length ? (
        <Card>
          <EmptyState title="No brands">{q ? "Nothing matches your search." : "Nothing to show here."}</EmptyState>
        </Card>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {rows.map(entry => (
            <li key={entry.slug}>
              <button
                type="button"
                onClick={() => setOpen(entry.slug)}
                className="flex w-full min-w-0 items-center gap-3 rounded-2xl border border-line bg-white p-3 text-left shadow-card hover:border-brand-500 focus-visible:outline-2 focus-visible:outline-brand-500"
              >
                <Mark entry={entry} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{entry.name}</span>
                  <span className="block truncate text-xs text-muted">{entry.company ?? entry.slugs.join(", ")}</span>
                  <span className="mt-1.5 flex flex-wrap gap-1">
                    {entry.logo_source ? (
                      <Badge tone={entry.logo_source === "upload" ? "green" : "blue"} dot={false}>
                        {sourceLabel[entry.logo_source]}
                      </Badge>
                    ) : (
                      <Badge tone="amber" dot={false}>
                        Initials
                      </Badge>
                    )}
                    {entry.card_url ? (
                      <Badge tone={entry.card_source === "upload" ? "green" : "blue"} dot={false}>
                        {entry.card_source === "upload" ? "Card uploaded" : "Card art"}
                      </Badge>
                    ) : null}
                    <Badge dot={false}>{`${entry.products.toLocaleString("en-GB")} product${entry.products === 1 ? "" : "s"}`}</Badge>
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {current ? <EntryDialog key={`${current.slug}:${current.updated_at ?? ""}`} entry={current} editable={editable} onClose={() => setOpen(null)} /> : null}
    </AdminShell>
  );
}
