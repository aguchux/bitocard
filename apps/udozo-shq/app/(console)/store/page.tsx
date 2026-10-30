"use client";

import { useRouter } from "next/navigation";
import { ExternalLink, Paintbrush, Plus, Settings2, Store as StoreIcon } from "lucide-react";
import { Badge, Button, Card, EmptyState, errorMessage, PageHeader, QueryView, Skeleton, StatusBadge } from "@bitocard/admin-ui";
import { AppLink } from "@bitocard/admin-ui/shell";
import { type Store, type StoreTemplate, useStoresQuery, useStoreTemplatesQuery } from "@bitocard/api-client/reseller";
import { ShqShell } from "@/components/shq-shell";
import { can, useReseller } from "@/components/reseller";
import { DesignPreview, resolveDesign, templateIcons } from "@/components/store-templates";

function StoreCard({ store, templates, canManage }: { store: Store; templates: StoreTemplate[]; canManage: boolean }) {
  const router = useRouter();
  const { template, variant, theme } = resolveDesign(templates, store);
  const Icon = templateIcons[store.template];
  return (
    <Card className="flex flex-col overflow-hidden">
      {variant && theme ? <DesignPreview style={variant.style} colors={{ ...theme.colors, primary: store.branding.primary_color ?? theme.colors.primary, accent: store.branding.accent_color ?? theme.colors.accent }} className="m-4 mb-0 h-36 rounded-xl" /> : null}
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-bold text-ink">{store.name}</h2>
            <a href={store.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 break-all text-sm text-brand-600 hover:underline">
              {store.url.replace(/^https:\/\//, "")} <ExternalLink className="size-3.5" aria-hidden />
            </a>
          </div>
          <StatusBadge status={store.status} />
        </div>
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
          <Icon className="size-4 text-brand-600" aria-hidden />
          <span className="font-semibold text-ink">{template?.name ?? store.template}</span>
          <span>·</span>
          <span>{variant?.name}</span>
          <span>·</span>
          <span>{theme?.name}</span>
          {store.checkout_mode === "test" ? <Badge tone="amber">Sandbox</Badge> : <Badge tone="green">Live</Badge>}
        </p>
        <p className="text-xs text-muted">{store.home.version ? `Home page v${store.home.version} live` : "Showing the design’s starting home page"}</p>
        <div className="mt-auto flex flex-wrap gap-2 pt-1">
          {canManage ? (
            <Button size="sm" icon={<Paintbrush className="size-4" aria-hidden />} onClick={() => router.push(`/store/${store.id}/design`)}>
              Design
            </Button>
          ) : null}
          <Button size="sm" variant="secondary" icon={<Settings2 className="size-4" aria-hidden />} onClick={() => router.push(`/store/${store.id}`)}>
            Settings
          </Button>
        </div>
      </div>
    </Card>
  );
}

/** Stores: every Resale shop the seller runs (as many as they like), each with its design, status and mode. */
export default function StoresPage() {
  const router = useRouter();
  const { membership } = useReseller();
  const canManage = can(membership, "admin");
  const stores = useStoresQuery();
  const templates = useStoreTemplatesQuery();
  const count = stores.data?.data.length ?? 0;

  return (
    <ShqShell section="store" current="/store" crumbs={[{ label: "Stores" }]}>
      <PageHeader
        title="Your stores"
        description="Each Resale shop has its own design, colours, listings and domain. Run as many as you like. A store is tested on its udozo.com address and goes live on its own domain."
        actions={
          canManage && count > 0 ? (
            <Button icon={<Plus className="size-4" aria-hidden />} onClick={() => router.push("/store/new")}>
              New store
            </Button>
          ) : null
        }
      />
      <QueryView query={stores} message={error => errorMessage(error, "Could not load your stores.")} loading={<Skeleton className="h-72 w-full" />}>
        {({ data }) =>
          data.length ? (
            <>
              <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                {data.map(store => (
                  <StoreCard key={store.id} store={store} templates={templates.data?.data ?? []} canManage={canManage} />
                ))}
              </div>
            </>
          ) : (
            <Card>
              <EmptyState title="No store yet" icon={<StoreIcon className="size-6" aria-hidden />}>
                {canManage ? (
                  <>
                    Choose a design and its colours, and your store is ready to test on its udozo.com address.{" "}
                    <AppLink href="/store/new" className="font-semibold text-brand-600 hover:underline">
                      Create your store
                    </AppLink>
                  </>
                ) : (
                  `The owner or an admin of ${membership.reseller.name} can create a store.`
                )}
              </EmptyState>
            </Card>
          )
        }
      </QueryView>
    </ShqShell>
  );
}
