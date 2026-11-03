"use client";

import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Check, Globe2, LayoutTemplate } from "lucide-react";
import { ActionDialog, Badge, Card, CardHeader, cn, errorMessage, Notice, PageHeader, QueryView, Skeleton } from "@bitocard/admin-ui";
import { can, useAdmin } from "@bitocard/admin-ui/shell";
import type { EditorRow, EditorSources } from "@bitocard/admin-ui/storefront";
import type { HomeRow, HomeSection } from "@bitocard/api-client/home";
import {
  type HomeLayoutInfo,
  type HomePage,
  type HomePageSummary,
  useClassifiedCategoriesQuery,
  useHomePageQuery,
  useHomePagesQuery,
  useHomePreviewMutation,
  usePublishHomeMutation,
  useResetHomeMutation,
  useResolveHomeRowsMutation,
  useRestoreHomeMutation,
  useSaveHomeRowsMutation,
  useSetHomeLayoutMutation,
  useUnpublishHomeMutation,
} from "@bitocard/api-client/admin";
import { homeRegistry, HomeFormProvider, HomeRowForm } from "@/components/home/registry";
import { blankRow, BlockThumb } from "@/components/home/row-forms";
import { homePreviewUrl } from "@/components/home/links";
import { UdozoShell } from "@/components/shell";

// The editor (drag and drop) loads on its own, after the page and its picker.
const RowsEditor = dynamic(() => import("@bitocard/admin-ui/storefront").then(module => module.RowsEditor<HomeSection>), { ssr: false, loading: () => <Skeleton className="h-96 w-full" /> });

const asEditorRows = (rows: HomeRow[]) => rows as unknown as EditorRow<HomeSection>[];
const asHomeRows = (rows: EditorRow<HomeSection>[]) => rows as unknown as HomeRow[];

/** Udozo's pages need no products or brands: the shared editor's catalogue lookups stay empty. */
const sources: EditorSources = {
  useProductSearch: () => ({ data: [], isLoading: false, error: null }),
  useBrands: () => null,
  image: { realm: "admin", purpose: "home_image" },
};

const lookWords = { navy: "Navy hero", brand: "Brand-colour hero", light: "Light hero", standard: "standard cards", compact: "compact cards", large: "large photo cards" } as const;

function PagePicker({ pages, current, onPick }: { pages: HomePageSummary[]; current: string; onPick: (page: string) => void }) {
  return (
    <nav aria-label="Home pages" className="flex flex-wrap gap-2">
      {pages.map(item => (
        <button
          key={item.page}
          type="button"
          aria-current={item.page === current ? "page" : undefined}
          onClick={() => onPick(item.page)}
          className={cn("flex min-h-11 items-center gap-2 rounded-xl border px-3 text-sm font-semibold", item.page === current ? "border-brand-500 bg-brand-50 text-ink" : "border-line text-muted hover:text-ink")}
        >
          {item.page === "global" ? <Globe2 className="size-4" aria-hidden /> : <span className="text-xs font-bold">{item.page}</span>}
          {item.name}
          <Badge tone={item.live ? "green" : "grey"}>{item.live ? `Live v${item.version}` : "Not live"}</Badge>
          {item.unpublished_changes && item.live ? <Badge tone="amber">Draft changes</Badge> : null}
        </button>
      ))}
    </nav>
  );
}

function LayoutChooser({ page, editable }: { page: HomePage; editable: boolean }) {
  const [setLayout, state] = useSetHomeLayoutMutation();
  const [choosing, setChoosing] = useState<HomeLayoutInfo | null>(null);
  const [replace, setReplace] = useState(true);
  return (
    <Card>
      <CardHeader title="Layout" description="How the page looks, and the rows it starts with. The editor below changes the rows and their blocks." />
      <ul className="grid gap-3 px-5 pb-5 sm:grid-cols-3 sm:px-6">
        {page.layouts.map(layout => {
          const chosen = page.layout === layout.key;
          return (
            <li key={layout.key}>
              <button
                type="button"
                disabled={!editable || chosen}
                aria-pressed={chosen}
                onClick={() => {
                  setReplace(true);
                  setChoosing(layout);
                }}
                className={cn("flex h-full w-full flex-col gap-2 rounded-xl border p-4 text-left disabled:cursor-default", chosen ? "border-brand-500 ring-2 ring-brand-500/30" : "border-line hover:border-ink/30")}
              >
                <span className="flex items-center gap-2 font-bold text-ink">
                  <LayoutTemplate className="size-4 text-brand-600" aria-hidden />
                  {layout.name}
                  {chosen ? <Check className="ml-auto size-4 text-brand-600" aria-label="Chosen" /> : null}
                </span>
                <span className="text-sm text-muted">{layout.description}</span>
                <span className="text-xs text-subtle">{`${lookWords[layout.look.hero]}, ${lookWords[layout.look.cards]}`}</span>
                {page.scope === "global" && layout.key === "explorer" ? <Badge tone="blue">Built around the countries</Badge> : null}
              </button>
            </li>
          );
        })}
      </ul>
      {state.error ? <div className="px-5 pb-5 sm:px-6"><Notice tone="red">{errorMessage(state.error)}</Notice></div> : null}
      <ActionDialog
        open={choosing !== null}
        onClose={() => setChoosing(null)}
        title={choosing ? `Use ${choosing.name}?` : "Change layout"}
        description="The draft takes the layout’s look. Visitors see nothing new until you publish."
        confirmLabel="Use this layout"
        requireReason={false}
        onConfirm={async () => void (await setLayout({ page: page.page, layout: choosing!.key, replace }).unwrap())}
      >
        <fieldset className="space-y-2 text-sm">
          <legend className="sr-only">The rows</legend>
          <label className="flex items-start gap-2">
            <input type="radio" name="sections" className="mt-1 accent-brand-600" checked={replace} onChange={() => setReplace(true)} />
            <span>
              <span className="font-semibold">Start from its rows</span>
              <span className="block text-muted">The draft’s rows are replaced by the layout’s own.</span>
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input type="radio" name="sections" className="mt-1 accent-brand-600" checked={!replace} onChange={() => setReplace(false)} />
            <span>
              <span className="font-semibold">Keep my rows</span>
              <span className="block text-muted">Only the look changes.</span>
            </span>
          </label>
        </fieldset>
      </ActionDialog>
    </Card>
  );
}

function Editor({ page, editable }: { page: HomePage; editable: boolean }) {
  const [save] = useSaveHomeRowsMutation();
  const [resolve] = useResolveHomeRowsMutation();
  const [publish] = usePublishHomeMutation();
  const [unpublish] = useUnpublishHomeMutation();
  const [reset] = useResetHomeMutation();
  const [restore] = useRestoreHomeMutation();
  const [preview] = useHomePreviewMutation();
  const pages = useHomePagesQuery();
  const markets = (pages.data?.data ?? []).filter(item => item.scope === "country").map(item => ({ country: item.page, name: item.name }));
  // Categories are the same everywhere; across countries, the first market's tree.
  const categories = useClassifiedCategoriesQuery(page.scope === "country" ? page.page : (markets[0]?.country ?? "NG"));
  const layoutName = (key: string | null) => page.layouts.find(layout => layout.key === key)?.name;
  return (
    <HomeFormProvider value={{ page: page.page, scope: page.scope, markets, categories: (categories.data?.data ?? []).map(top => ({ slug: top.slug, name: top.name, children: top.children.map(child => ({ slug: child.slug, name: child.name })) })) }}>
      <RowsEditor
        // A new layout (or a restored version) is a new working copy.
        key={`${page.page}-${page.layout}-${page.updated_at}`}
        page={{
          rows: asEditorRows(page.rows),
          updatedAt: page.updated_at,
          live: page.live,
          version: page.version || null,
          unpublishedChanges: page.unpublished_changes,
          versions: page.versions.map(item => ({ version: item.version, publishedAt: item.published_at, note: layoutName(item.layout) })),
        }}
        allowed={page.blocks_allowed}
        registry={homeRegistry}
        RowForm={HomeRowForm}
        blankRow={blankRow}
        Thumb={BlockThumb}
        title={`${page.name} home page`}
        description={page.scope === "global" ? "Shown on udozo.com when a visitor chose All countries (or nothing yet): never prices, each listing names its country." : `udozo.com/${page.page.toLowerCase()}: ${page.name}'s home page.`}
        editable={editable}
        previewable
        sources={sources}
        copy={{
          publish: "Visitors see this page within a minute. Earlier versions stay in Versions, each with its layout.",
          reset: { label: "Start from the layout", description: "The draft is replaced by the layout’s own rows. Visitors see no change until you publish." },
          empty: "The page has no rows. Add one, or start from the layout.",
          viewOnly: "Only operations admins change home pages.",
          notLive: "Visitors see the layout’s starting page. Publish to show yours.",
        }}
        actions={{
          saveDraft: rows => save({ page: page.page, rows: asHomeRows(rows) }).unwrap(),
          publish: () => publish(page.page).unwrap(),
          unpublish: () => unpublish(page.page).unwrap(),
          reset: async () => asEditorRows((await reset(page.page).unwrap()).rows),
          restore: async version => asEditorRows((await restore({ page: page.page, version }).unwrap()).rows),
          preview: async () => homePreviewUrl(page.page, (await preview(page.page).unwrap()).token),
          resolve: async rows => {
            const filled = await resolve({ page: page.page, rows: asHomeRows(rows) }).unwrap();
            return Object.fromEntries(filled.rows.flatMap(row => row.blocks.map(block => [block.id, block])));
          },
        }}
      >
        <LayoutChooser page={page} editable={editable} />
      </RowsEditor>
    </HomeFormProvider>
  );
}

function HomePages() {
  const admin = useAdmin();
  const editable = can(admin, "operations");
  const router = useRouter();
  const params = useSearchParams();
  const pages = useHomePagesQuery();
  const current = params.get("page") ?? pages.data?.data[0]?.page ?? "global";
  const page = useHomePageQuery(current, { skip: !pages.data });
  return (
    <UdozoShell section="theme" current="/home-pages" crumbs={[{ label: "Site", href: "/home-pages" }, { label: "Home pages" }]}>
      <PageHeader title="Home pages" description="udozo.com’s home page across countries and each country’s own: a layout, then rows of blocks, with the live page beside them. Save is automatic; publish when ready." />
      {!editable ? <Notice tone="grey">Only operations admins change home pages. You can look and preview.</Notice> : null}
      <div className="space-y-6">
        <QueryView query={pages} loading={<Skeleton className="h-11 w-full" />}>{data => <PagePicker pages={data.data} current={current} onPick={next => router.replace(`/home-pages?page=${next}`)} />}</QueryView>
        <QueryView query={page} loading={<Skeleton className="h-64 w-full" />}>{data => <Editor page={data} editable={editable} />}</QueryView>
      </div>
    </UdozoShell>
  );
}

export default function HomePagesPage() {
  return (
    <Suspense>
      <HomePages />
    </Suspense>
  );
}
