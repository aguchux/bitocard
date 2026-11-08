"use client";

import { useId, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Plus } from "lucide-react";
import { ActionDialog, Badge, Button, Card, CardHeader, Dialog, errorMessage, Field, formatDateTime, ImageField, Input, Notice, PageHeader, QueryView, Select, Skeleton, Textarea, Toggle } from "@bitocard/admin-ui";
import { can, useAdmin } from "@bitocard/admin-ui/shell";
import {
  type HeroLayout,
  type HeroLinkKind,
  type HeroSlide,
  type HeroSlideInput,
  type HeroState,
  type HeroTileInput,
  heroTileCount,
  useCreateHeroSlideMutation,
  useDeleteHeroSlideMutation,
  useHeroSlidesQuery,
  useHomePagesQuery,
  useReorderHeroSlidesMutation,
  useUpdateHeroSlideMutation,
} from "@bitocard/api-client/admin";
import { HeroTargetField } from "@/components/hero-target-field";
import { UdozoShell } from "@/components/shell";

/** Each split, its rows top to bottom (in thirds of the column's height), and the image size that fits each banner. */
const heroLayouts: Record<HeroLayout, { name: string; rows: number[] }> = {
  full: { name: "One banner", rows: [3] },
  third_two_thirds: { name: "A third over two thirds", rows: [1, 2] },
  two_thirds_third: { name: "Two thirds over a third", rows: [2, 1] },
  thirds: { name: "Three thirds", rows: [1, 1, 1] },
};
const sizeFor: Record<number, string> = { 3: "900 × 1000 px", 2: "900 × 660 px", 1: "900 × 330 px" };

const linkKinds: Record<HeroLinkKind, { name: string; label: string; placeholder: string; hint: string }> = {
  listing: { name: "A listing", label: "Listing", placeholder: "Type its title, number or SKU", hint: "Choose from the suggestions, or type its number (in its address, /ng/l/100123-…) or SKU." },
  brand: { name: "A brand", label: "Brand", placeholder: "Type the brand’s name", hint: "Choose from the suggestions. Opens its page in the market being viewed." },
  seller: { name: "A seller", label: "Seller", placeholder: "Type their username or name", hint: "Choose from the suggestions, or type their username or handle." },
  category: { name: "A category", label: "Category", placeholder: "Type the category’s name", hint: "Choose from the suggestions. Opens it in the market being viewed (across countries on the global page)." },
  url: { name: "Any address", label: "Address", placeholder: "/ng/c/mobile-phones", hint: "A page on udozo.com, such as /ng/c/mobile-phones, or an https address elsewhere (opens in a new tab)." },
};

const stateTones: Record<HeroState, "green" | "grey" | "blue" | "amber"> = { showing: "green", off: "grey", scheduled: "blue", ended: "amber" };
const stateLabels: Record<HeroState, string> = { showing: "Showing", off: "Off", scheduled: "Scheduled", ended: "Ended" };

const local = (iso: string | null) => {
  if (!iso) return "";
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

type Market = { code: string; name: string };
/** `label`: what the target names, once chosen from the suggestions (or as the API last read it). */
type TileDraft = { image_url: string; alt: string; kind: HeroLinkKind; target: string; label: string | null; ad: boolean };
const emptyTile = (): TileDraft => ({ image_url: "", alt: "", kind: "listing", target: "", label: null, ad: true });

/** A drawing of a split: its rows in thirds, closely gapped, with small rounded corners (as udozo.com draws it). */
function LayoutDrawing({ layout, images }: { layout: HeroLayout; images?: Array<{ src: string; alt: string } | null> }) {
  return (
    <span className="grid h-full w-full gap-1" style={{ gridTemplateRows: "repeat(3, minmax(0, 1fr))" }}>
      {heroLayouts[layout].rows.map((span, index) => {
        const image = images?.[index];
        return (
          <span key={index} className="block min-h-0 overflow-hidden rounded-sm bg-navy-100" style={{ gridRow: `span ${span} / span ${span}` }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- uploaded banners on Udozo's storage */}
            {image?.src ? <img src={image.src} alt={image.alt} className="size-full object-cover" /> : null}
          </span>
        );
      })}
    </span>
  );
}

function SlideForm({ markets, scope, slide, onDone }: { markets: Market[]; scope: string; slide: HeroSlide | null; onDone: () => void }) {
  const id = useId();
  const [create, created] = useCreateHeroSlideMutation();
  const [update, updated] = useUpdateHeroSlideMutation();
  const [market, setMarket] = useState(slide ? (slide.country ?? "") : scope === "global" ? "" : scope);
  const [layout, setLayout] = useState<HeroLayout>(slide?.layout ?? "full");
  const [tiles, setTiles] = useState<TileDraft[]>(
    slide ? slide.tiles.map(tile => ({ image_url: tile.image_url, alt: tile.alt, kind: tile.link.kind, target: tile.link.target, label: tile.link.label, ad: tile.ad })) : [emptyTile()],
  );
  const [enabled, setEnabled] = useState(slide?.enabled ?? true);
  const [startsAt, setStartsAt] = useState(local(slide?.starts_at ?? null));
  const [endsAt, setEndsAt] = useState(local(slide?.ends_at ?? null));
  const [note, setNote] = useState(slide?.note ?? "");
  const state = slide ? updated : created;
  const param = ((state.error ?? null) as { param?: string } | null)?.param;
  const errorFor = (name: string) => (param === name ? errorMessage(state.error) : undefined);

  const chooseLayout = (next: HeroLayout) => {
    setLayout(next);
    setTiles(current => Array.from({ length: heroTileCount[next] }, (_, index) => current[index] ?? emptyTile()));
  };
  const change = (index: number, patch: Partial<TileDraft>) => setTiles(current => current.map((tile, at) => (at === index ? { ...tile, ...patch } : tile)));
  const swap = (index: number, by: -1 | 1) =>
    setTiles(current => {
      const next = [...current];
      [next[index], next[index + by]] = [next[index + by]!, next[index]!];
      return next;
    });

  const submit = async () => {
    const body: HeroSlideInput = {
      country: market || null,
      layout,
      tiles: tiles.map((tile): HeroTileInput => ({ image_url: tile.image_url.trim(), alt: tile.alt.trim(), link: { kind: tile.kind, target: tile.target.trim() }, ad: tile.ad })),
      enabled,
      starts_at: startsAt ? new Date(startsAt).toISOString() : null,
      ends_at: endsAt ? new Date(endsAt).toISOString() : null,
      note: note.trim() || null,
    };
    const done = slide ? update({ id: slide.id, ...body }) : create(body);
    if (await done.unwrap().then(() => true).catch(() => false)) onDone();
  };

  return (
    <form
      className="grid gap-5"
      onSubmit={event => {
        event.preventDefault();
        void submit();
      }}
    >
      <Field label="Market" htmlFor={`${id}-market`} hint="A market shows its own columns first, then those for every market." error={errorFor("country")}>
        <Select id={`${id}-market`} value={market} onChange={event => setMarket(event.target.value)}>
          <option value="">Every market</option>
          {markets.map(item => (
            <option key={item.code} value={item.code}>
              {item.name}
            </option>
          ))}
        </Select>
      </Field>
      <fieldset className="grid gap-2">
        <legend className="mb-2 text-sm font-semibold text-navy-900">How the column is split</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(Object.keys(heroLayouts) as HeroLayout[]).map(key => (
            <label key={key} className={`grid cursor-pointer justify-items-center gap-2 border p-2 text-center text-xs font-medium ${layout === key ? "border-pink-500 bg-pink-50 text-navy-900" : "border-line text-ink"}`}>
              <input type="radio" name={`${id}-layout`} value={key} checked={layout === key} onChange={() => chooseLayout(key)} className="sr-only" />
              <span className="block h-20 w-16" aria-hidden="true">
                <LayoutDrawing layout={key} />
              </span>
              {heroLayouts[key].name}
            </label>
          ))}
        </div>
        {errorFor("layout") || errorFor("tiles") ? <p className="text-sm text-red-700">{errorFor("layout") ?? errorFor("tiles")}</p> : null}
      </fieldset>
      {tiles.map((tile, index) => {
        const rows = heroLayouts[layout].rows[index] ?? 1;
        const at = `tiles[${index}]`;
        const kind = linkKinds[tile.kind];
        return (
          <fieldset key={index} className="grid gap-3 border border-line p-3">
            <legend className="px-1 text-sm font-semibold text-navy-900">
              {tiles.length === 1 ? "The banner" : `Banner ${index + 1} of ${tiles.length}`} <span className="font-normal text-ink">({rows === 3 ? "the whole column" : rows === 2 ? "two thirds" : "a third"}; {index === 0 ? "top" : index === tiles.length - 1 ? "bottom" : "middle"})</span>
            </legend>
            {tiles.length > 1 ? (
              <div className="flex gap-2">
                <Button type="button" size="sm" variant="secondary" disabled={index === 0} onClick={() => swap(index, -1)} icon={<ArrowUp className="size-4" aria-hidden />}>
                  Move up
                </Button>
                <Button type="button" size="sm" variant="secondary" disabled={index === tiles.length - 1} onClick={() => swap(index, 1)} icon={<ArrowDown className="size-4" aria-hidden />}>
                  Move down
                </Button>
              </div>
            ) : null}
            <ImageField
              label="Image"
              realm="admin"
              purpose="hero_image"
              value={tile.image_url}
              onChange={value => change(index, { image_url: value })}
              hint={`JPEG, PNG or WebP. Best ${sizeFor[rows]}: it fills its space and is cropped to fit, so keep what matters in the middle.`}
              error={errorFor(`${at}.image_url`)}
            />
            <Field label="What the banner says" htmlFor={`${id}-alt-${index}`} hint="Read out to people who cannot see the image. Up to 120 characters." error={errorFor(`${at}.alt`)}>
              <Input id={`${id}-alt-${index}`} value={tile.alt} maxLength={120} onChange={event => change(index, { alt: event.target.value })} required />
            </Field>
            <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
              <Field label="Links to" htmlFor={`${id}-kind-${index}`} error={errorFor(`${at}.link.kind`)}>
                <Select id={`${id}-kind-${index}`} value={tile.kind} onChange={event => change(index, { kind: event.target.value as HeroLinkKind, target: "", label: null })}>
                  {(Object.keys(linkKinds) as HeroLinkKind[]).map(key => (
                    <option key={key} value={key}>
                      {linkKinds[key].name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={kind.label} htmlFor={`${id}-target-${index}`} hint={kind.hint} error={errorFor(`${at}.link.target`)}>
                {tile.kind === "url" ? (
                  <Input id={`${id}-target-${index}`} value={tile.target} placeholder={kind.placeholder} onChange={event => change(index, { target: event.target.value })} required />
                ) : (
                  <HeroTargetField
                    id={`${id}-target-${index}`}
                    kind={tile.kind}
                    scope={market || "global"}
                    value={tile.target}
                    chosen={tile.label}
                    placeholder={kind.placeholder}
                    invalid={Boolean(errorFor(`${at}.link.target`))}
                    onChange={(target, label) => change(index, { target, label })}
                  />
                )}
              </Field>
            </div>
            <div className="flex items-center gap-3">
              <Toggle checked={tile.ad} onChange={ad => change(index, { ad })} label={`Label banner ${index + 1} as an ad`} />
              <span className="text-sm text-ink">{tile.ad ? "Labelled Ad (someone else’s product or offer)" : "Not labelled: Udozo’s own promotion"}</span>
            </div>
          </fieldset>
        );
      })}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Starts" htmlFor={`${id}-starts`} hint="Optional: at once when empty." error={errorFor("starts_at")}>
          <Input id={`${id}-starts`} type="datetime-local" value={startsAt} onChange={event => setStartsAt(event.target.value)} />
        </Field>
        <Field label="Ends" htmlFor={`${id}-ends`} hint="Optional: until switched off when empty." error={errorFor("ends_at")}>
          <Input id={`${id}-ends`} type="datetime-local" value={endsAt} onChange={event => setEndsAt(event.target.value)} />
        </Field>
      </div>
      <div className="flex items-center gap-3">
        <Toggle checked={enabled} onChange={setEnabled} label="Show this column" />
        <span className="text-sm text-ink">{enabled ? "On: shows on udozo.com" : "Off: never shows"}</span>
      </div>
      <Field label="Note" htmlFor={`${id}-note`} hint="Optional, for the team only: who it is for, what was agreed.">
        <Textarea id={`${id}-note`} value={note} maxLength={300} onChange={event => setNote(event.target.value)} />
      </Field>
      {state.error && !param ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={state.isLoading}>
          {slide ? "Save column" : "Add column"}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function Reel({ markets, editable }: { markets: Market[]; editable: boolean }) {
  const [scope, setScope] = useState("global");
  const slides = useHeroSlidesQuery(scope);
  const [update] = useUpdateHeroSlideMutation();
  const [reorder, reordering] = useReorderHeroSlidesMutation();
  const [remove] = useDeleteHeroSlideMutation();
  const [form, setForm] = useState<HeroSlide | "new" | null>(null);
  const [deleting, setDeleting] = useState<HeroSlide | null>(null);
  const move = (list: HeroSlide[], index: number, by: -1 | 1) => {
    const ids = list.map(item => item.id);
    [ids[index], ids[index + by]] = [ids[index + by]!, ids[index]!];
    void reorder({ scope, ids });
  };
  return (
    <Card>
      <CardHeader
        title="Columns"
        description="udozo.com’s home page starts with these columns sliding past, in this order: the market’s own, then those for every market. Visitors can drag, swipe or scroll them too. Changes show within a minute."
        actions={editable ? <Button icon={<Plus className="size-4" aria-hidden />} onClick={() => setForm("new")}>Add column</Button> : undefined}
      />
      <div className="px-5 pb-4 sm:px-6">
        <Select aria-label="Market" value={scope} onChange={event => setScope(event.target.value)} className="w-auto">
          <option value="global">Every market</option>
          {markets.map(item => (
            <option key={item.code} value={item.code}>
              {item.name}
            </option>
          ))}
        </Select>
      </div>
      <QueryView query={slides} loading={<Skeleton className="m-5 h-64" />}>
        {data =>
          data.data.length ? (
            <ol aria-label="Columns in order" className="flex gap-3 overflow-x-auto px-5 pb-5 sm:px-6">
              {data.data.map((slide, index) => (
                <li key={slide.id} className="grid w-56 shrink-0 content-start gap-2">
                  <span className="block h-60 w-56">
                    <LayoutDrawing layout={slide.layout} images={slide.tiles.map(tile => ({ src: tile.image_url, alt: tile.alt }))} />
                  </span>
                  <span className="flex flex-wrap items-center gap-2 text-sm">
                    <strong className="text-navy-900">{index + 1}.</strong> {heroLayouts[slide.layout].name}
                    <Badge tone={stateTones[slide.state]}>{stateLabels[slide.state]}</Badge>
                  </span>
                  <ul className="grid gap-1 text-xs text-ink">
                    {slide.tiles.map(tile => (
                      <li key={tile.id} className="truncate">
                        {tile.link.href ? (
                          <span title={tile.link.href}>→ {tile.link.label ?? tile.link.href}</span>
                        ) : (
                          <span className="text-red-700">→ {tile.link.label ?? tile.link.target}: gone, shown without a link</span>
                        )}
                      </li>
                    ))}
                  </ul>
                  {slide.starts_at || slide.ends_at ? <span className="text-xs text-ink">{`${slide.starts_at ? formatDateTime(slide.starts_at) : "Now"} – ${slide.ends_at ? formatDateTime(slide.ends_at) : "No end"}`}</span> : null}
                  <Toggle checked={slide.enabled} disabled={!editable} label={`Show column ${index + 1}`} onChange={enabled => void update({ id: slide.id, enabled })} />
                  {editable ? (
                    <span className="flex flex-wrap gap-1">
                      <Button size="sm" variant="secondary" disabled={index === 0 || reordering.isLoading} onClick={() => move(data.data, index, -1)} icon={<ArrowLeft className="size-4" aria-hidden />}>
                        <span className="sr-only">Move column {index + 1} earlier</span>
                      </Button>
                      <Button size="sm" variant="secondary" disabled={index === data.data.length - 1 || reordering.isLoading} onClick={() => move(data.data, index, 1)} icon={<ArrowRight className="size-4" aria-hidden />}>
                        <span className="sr-only">Move column {index + 1} later</span>
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => setForm(slide)}>
                        Edit
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setDeleting(slide)}>
                        Delete
                      </Button>
                    </span>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : (
            <p className="px-5 pb-5 text-sm text-ink sm:px-6">No columns here yet. Without any, udozo.com shows the home page’s own hero.</p>
          )
        }
      </QueryView>
      <Dialog open={form !== null} onClose={() => setForm(null)} title={form === "new" ? "Add a column" : "Change the column"}>
        {form !== null ? <SlideForm markets={markets} scope={scope} slide={form === "new" ? null : form} onDone={() => setForm(null)} /> : null}
      </Dialog>
      <ActionDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title="Delete this column?"
        description="It leaves udozo.com within a minute. Switch it off instead to keep it for later."
        confirmLabel="Delete"
        tone="danger"
        requireReason={false}
        onConfirm={async () => void (await remove(deleting!.id).unwrap())}
      />
    </Card>
  );
}

/** Site › Hero slider: the columns of banners sliding past at the top of udozo.com's home pages. */
export default function HeroSliderPage() {
  const admin = useAdmin();
  const editable = can(admin, "operations");
  const pages = useHomePagesQuery();
  return (
    <UdozoShell section="theme" current="/hero-slider" crumbs={[{ label: "Site", href: "/home-pages" }, { label: "Hero slider" }]}>
      <PageHeader
        title="Hero slider"
        description="The top of udozo.com’s home pages: columns three rows high, each holding one banner, two (a third and two thirds, either way up) or three, sliding past. Each banner links to a listing, a brand, a seller, a category or any address."
      />
      {!editable ? <Notice tone="grey">Only operations admins add and change the hero slider.</Notice> : null}
      <QueryView query={pages} loading={<Skeleton className="h-48 w-full" />}>
        {data => <Reel markets={data.data.filter(item => item.scope === "country").map(item => ({ code: item.page, name: item.name }))} editable={editable} />}
      </QueryView>
    </UdozoShell>
  );
}
