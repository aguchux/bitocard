"use client";

import { QueryView, Skeleton } from "@bitocard/admin-ui";
import { AdminShell, can, useAdmin } from "@bitocard/admin-ui/shell";
import { bitocardSectionTypes, type EditorSources, HomeEditor } from "@bitocard/admin-ui/storefront";
import {
  type StorefrontPage,
  useProductsInfiniteQuery,
  usePublishStorefrontMutation,
  useResetStorefrontMutation,
  useRestoreStorefrontMutation,
  useSaveStorefrontDraftMutation,
  useStorefrontBrandsQuery,
  useStorefrontHomeQuery,
  useStorefrontPreviewMutation,
  useUnpublishStorefrontMutation,
} from "@bitocard/api-client/admin";
import type { Section, StoreSection } from "@bitocard/api-client/storefront";
import { previewUrl } from "./storefront-url";

/** bitocard.com's catalogue, brands and storage for the editor. */
const sources: EditorSources = {
  useProductSearch: q => {
    const products = useProductsInfiniteQuery({ q }, { skip: q.length < 2 });
    return { data: products.data?.pages[0]?.data, isLoading: products.isLoading, isFetching: products.isFetching, error: products.error, refetch: products.refetch };
  },
  useBrands: enabled => {
    const brands = useStorefrontBrandsQuery(undefined, { skip: !enabled });
    return { data: brands.data?.data, isLoading: brands.isLoading, error: brands.error };
  },
  image: { realm: "admin", purpose: "storefront_image" },
};

function Editor({ page, editable, previewable }: { page: StorefrontPage; editable: boolean; previewable: boolean }) {
  const [saveDraft] = useSaveStorefrontDraftMutation();
  const [publish] = usePublishStorefrontMutation();
  const [unpublish] = useUnpublishStorefrontMutation();
  const [restore] = useRestoreStorefrontMutation();
  const [reset] = useResetStorefrontMutation();
  const [preview] = useStorefrontPreviewMutation();
  return (
    <HomeEditor
      page={{
        draft: page.draft,
        updatedAt: page.updated_at,
        live: page.live,
        version: page.version,
        unpublishedChanges: page.unpublished_changes,
        versions: page.versions.map(item => ({ version: item.version, publishedAt: item.published_at })),
      }}
      allowed={bitocardSectionTypes}
      title="Home page"
      description="bitocard.com's home page. Arrange sections on the grid and change what each shows; visitors see it once published."
      editable={editable}
      previewable={previewable}
      sources={sources}
      copy={{
        publish: "Visitors to bitocard.com see this layout within a minute. The current live version stays in Versions.",
        reset: { label: "Reset to default", description: "Your draft is replaced by BitoCard's default home page. What visitors see does not change until you publish." },
        empty: "The home page has no sections. Add one, or reset to the default layout.",
        viewOnly: "You can view the layout and preview it, but only operations admins can change it.",
        notLive: "The home page is not live. Publish to show it on bitocard.com.",
      }}
      actions={{
        saveDraft: sections => saveDraft(sections as Section[]).unwrap(),
        publish: () => publish().unwrap(),
        unpublish: () => unpublish().unwrap(),
        reset: async () => (await reset().unwrap()).draft as StoreSection[],
        restore: async version => (await restore(version).unwrap()).draft as StoreSection[],
        preview: async () => previewUrl((await preview().unwrap()).token),
      }}
    />
  );
}

/** Storefront Manager: bitocard.com's home page layout. */
export default function StorefrontHomePage() {
  const admin = useAdmin();
  const home = useStorefrontHomeQuery();
  const editable = can(admin, "operations");
  const previewable = can(admin, "operations", "support");

  return (
    <AdminShell section="storefront" current="/storefront" crumbs={[{ label: "Storefront", href: "/storefront" }, { label: "Home page" }]}>
      <QueryView
        query={home}
        loading={
          <div className="space-y-4" aria-busy="true" aria-label="Loading">
            <Skeleton className="h-12 w-72" />
            <Skeleton className="h-96 w-full" />
          </div>
        }
      >
        {page => <Editor page={page} editable={editable} previewable={previewable} />}
      </QueryView>
    </AdminShell>
  );
}
