"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { Layers } from "lucide-react";
import { ActionDialog, Button, Card, CardHeader, Dialog, EmptyState, errorMessage, Notice, QueryView, Skeleton } from "@bitocard/admin-ui";
import { AppLink } from "@bitocard/admin-ui/shell";
import type { EditorSources } from "@bitocard/admin-ui/storefront";
import dynamic from "next/dynamic";

/** The home page editor (with drag and drop) loads on its own, so the rest of the page draws first. */
const HomeEditor = dynamic(() => import("@bitocard/admin-ui/storefront").then(module => module.HomeEditor), {
  loading: () => <Skeleton className="h-[32rem] w-full" />,
});
import {
  type Store,
  type StoreHomeEditor,
  type StoreTemplate,
  usePreviewStoreHomeMutation,
  usePublishStoreHomeMutation,
  useResetStoreHomeMutation,
  useRestoreStoreHomeMutation,
  useSaveStoreHomeMutation,
  useStoreHomeQuery,
  useStoreHomeVersionsQuery,
  useStoresQuery,
  useResaleCategoriesQuery,
  useStoreTemplatesQuery,
  useUpdateStoreMutation,
} from "@bitocard/api-client/reseller";
import type { ProductCategory, StoreTemplateKey } from "@bitocard/api-client/storefront";
import { ShqShell } from "@/components/shq-shell";
import { can, useReseller } from "@/components/reseller";
import { resaleTemplates, resolveDesign, TemplateCards, templateIcons, VariantAndTheme } from "@/components/store-templates";

/** No catalogue products on Udozo: a Resale shop's sections show listings, by Udozo's categories. */
const noProducts = { data: [], isLoading: false, error: null };

/** Udozo's categories for the listing sections, brands typed by slug, and the seller's store image storage. */
function sourcesFor(template: StoreTemplate | undefined, resaleCategories?: Array<{ slug: string; name: string }>): EditorSources {
  return {
    useProductSearch: () => noProducts,
    useBrands: () => null,
    image: { realm: "reseller", purpose: "store_image" },
    categories: (template?.categories as ProductCategory[] | null | undefined) ?? undefined,
    resaleCategories,
  };
}

/** The store's template, design and colours: a new design or colours apply at once; a new template asks first. */
function DesignChoice({ store, templates }: { store: Store; templates: StoreTemplate[] }) {
  const [update, state] = useUpdateStoreMutation();
  const [choosing, setChoosing] = useState(false);
  const [pending, setPending] = useState<StoreTemplateKey | null>(null);
  const { template } = resolveDesign(templates, store);
  const Icon = templateIcons[store.template];
  if (!template) return null;
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Icon className="size-5 text-brand-600" aria-hidden /> {template.name}
          </span>
        }
        description={`${template.tagline} Choosing a design or colours keeps your home page; the store's own brand colours are set to the theme's.`}
        actions={
          // Udozo offers the Resale shop alone; another template, should its API list one, can still be chosen.
          templates.length > 1 ? (
            <Button variant="secondary" icon={<Layers className="size-4" aria-hidden />} onClick={() => setChoosing(true)}>
              Change template
            </Button>
          ) : null
        }
      />
      <div className="p-5 sm:p-6">
        {state.error ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
        <VariantAndTheme template={template} variant={store.variant} theme={store.theme} disabled={state.isLoading} onChange={next => void update({ id: store.id, ...next }).unwrap().catch(() => undefined)} />
      </div>
      <Dialog size="full" open={choosing} onClose={() => setChoosing(false)} title="Change template" description="A template decides what the store sells and which sections its home page offers.">
        <TemplateCards
          templates={templates}
          value={store.template}
          onChange={key => {
            setChoosing(false);
            if (key !== store.template) setPending(key);
          }}
        />
      </Dialog>
      <ActionDialog
        open={Boolean(pending)}
        onClose={() => setPending(null)}
        title={`Switch to ${templates.find(item => item.key === pending)?.name ?? "this template"}?`}
        description="Your home page starts again from the new template’s first design, and the store sells only what the new template sells. Earlier versions of the page can no longer be restored."
        confirmLabel="Switch template"
        tone="danger"
        requireReason={false}
        onConfirm={async () => {
          if (pending) await update({ id: store.id, template: pending }).unwrap();
        }}
      />
    </Card>
  );
}

function Designer({ store, home, templates }: { store: Store; home: StoreHomeEditor; templates: StoreTemplate[] }) {
  const versions = useStoreHomeVersionsQuery(store.id);
  const [save] = useSaveStoreHomeMutation();
  const [publish] = usePublishStoreHomeMutation();
  const [reset] = useResetStoreHomeMutation();
  const [restore] = useRestoreStoreHomeMutation();
  const [preview] = usePreviewStoreHomeMutation();
  const { template } = resolveDesign(templates, store);
  // A Resale shop's listing sections choose among Udozo's categories in the reseller's country.
  const { membership } = useReseller();
  const country = membership.reseller.country ?? "";
  const categories = useResaleCategoriesQuery(country, { skip: !template?.resale || !country });
  const resaleCategories = useMemo(() => categories.data?.data.flatMap(top => [{ slug: top.slug, name: top.name }, ...top.children.map(child => ({ slug: child.slug, name: `  ${child.name}` }))]), [categories.data]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the editor keeps one set of sources; the categories arrive once
  const sources = useMemo(() => sourcesFor(template, resaleCategories), [resaleCategories]);
  return (
    <HomeEditor
      key={home.template}
      page={{
        draft: home.draft,
        updatedAt: home.updated_at,
        live: home.published,
        version: home.version,
        unpublishedChanges: !home.published,
        versions: (versions.data?.data ?? []).map(item => ({ version: item.version, publishedAt: item.published_at, restorable: item.restorable, note: item.restorable ? undefined : "another template" })),
      }}
      allowed={home.sections_allowed}
      title="Home page"
      description={`${store.name}'s home page. Arrange sections on the grid and change what each shows; shoppers see it once published.`}
      editable
      previewable
      sources={sources}
      copy={{
        publish: "Shoppers see this home page within a minute. Earlier versions stay in Versions. Everything on it must be yours to use and honest.",
        reset: { label: "Start from the design", description: "Your draft is replaced by the design’s starting home page. What shoppers see does not change until you publish." },
        empty: "The home page has no sections. Add one, or start from the design.",
        notLive: "Shoppers see the design’s starting home page. Publish to show yours.",
      }}
      actions={{
        saveDraft: sections => save({ id: store.id, sections }).unwrap(),
        publish: () => publish(store.id).unwrap(),
        reset: async () => (await reset(store.id).unwrap()).draft,
        restore: async version => (await restore({ id: store.id, version }).unwrap()).draft,
        preview: async () => (await preview(store.id).unwrap()).url,
      }}
    >
      <DesignChoice store={store} templates={resaleTemplates(templates)} />
      <p className="text-xs text-muted">
        You are responsible for the words, logos and images you publish: they must be yours to use, honest and free of anyone&apos;s personal details, and never claim
        that your store owns, makes or stocks what it resells.
      </p>
    </HomeEditor>
  );
}

/** Store > a store > Design: its template, design and colours, and its home page editor. */
export default function StoreDesignPage() {
  const { id } = useParams<{ id: string }>();
  const { membership } = useReseller();
  const stores = useStoresQuery();
  const templates = useStoreTemplatesQuery();
  const home = useStoreHomeQuery(id);
  const store = stores.data?.data.find(item => item.id === id);
  return (
    <ShqShell section="store" current="/store" crumbs={[{ label: "Stores", href: "/store" }, { label: store?.name ?? "Store", href: `/store/${id}` }, { label: "Design" }]}>
      {!can(membership, "admin") ? (
        <Notice tone="blue">The owner or an admin of {membership.reseller.name} designs the store.</Notice>
      ) : (
        <QueryView query={home} message={error => errorMessage(error, "Could not load the store’s home page.")} loading={<Skeleton className="h-96 w-full" />}>
          {data =>
            store && templates.data ? (
              <div className="space-y-6">
                <Designer store={store} home={data} templates={templates.data.data} />
              </div>
            ) : stores.isLoading || templates.isLoading ? (
              <Skeleton className="h-96 w-full" />
            ) : (
              <Card>
                <EmptyState title="No such store">
                  <AppLink href="/store" className="font-semibold text-brand-600 hover:underline">
                    Back to your stores
                  </AppLink>
                </EmptyState>
              </Card>
            )
          }
        </QueryView>
      )}
    </ShqShell>
  );
}
