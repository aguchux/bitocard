"use client";

import { useParams, useRouter } from "next/navigation";
import { Paintbrush } from "lucide-react";
import { Button, Card, CardHeader, EmptyState, errorMessage, PageHeader, QueryView, Skeleton } from "@bitocard/admin-ui";
import { AppLink } from "@bitocard/admin-ui/shell";
import { useStoresQuery, useStoreTemplatesQuery } from "@bitocard/api-client/reseller";
import { ShqShell } from "@/components/shq-shell";
import { can, useReseller } from "@/components/reseller";
import { StoreDetails } from "@/components/store-settings";
import { DesignPreview, resolveDesign, templateIcons } from "@/components/store-templates";

/** Store > a store: its design at a glance (to the editor), then its settings. */
export default function StorePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { membership } = useReseller();
  const canManage = can(membership, "admin");
  const stores = useStoresQuery();
  const templates = useStoreTemplatesQuery();
  const store = stores.data?.data.find(item => item.id === id);

  return (
    <ShqShell section="store" current="/store" crumbs={[{ label: "Store", href: "/store" }, { label: store?.name ?? "Store" }]}>
      <PageHeader title={store?.name ?? "Store"} description="Its design, address, branding, publishing, checkout and identity checks." />
      <QueryView query={stores} message={error => errorMessage(error, "Could not load your store.")} loading={<Skeleton className="h-72 w-full" />}>
        {() => {
          if (!store) {
            return (
              <Card>
                <EmptyState title="No such store">
                  It may have been removed. <AppLink href="/store" className="font-semibold text-brand-600 hover:underline">Back to your stores</AppLink>
                </EmptyState>
              </Card>
            );
          }
          const { template, variant, theme } = resolveDesign(templates.data?.data ?? [], store);
          const Icon = templateIcons[store.template];
          return (
            <div className="space-y-6">
              <Card>
                <CardHeader
                  title="Design"
                  description="The template decides what the store sells; its design and colours how it looks. Edit the home page section by section."
                  actions={
                    canManage ? (
                      <Button icon={<Paintbrush className="size-4" aria-hidden />} onClick={() => router.push(`/store/${store.id}/design`)}>
                        Edit design
                      </Button>
                    ) : null
                  }
                />
                <div className="grid gap-5 p-5 sm:grid-cols-[220px_minmax(0,1fr)] sm:p-6">
                  {variant && theme ? <DesignPreview style={variant.style} colors={{ ...theme.colors, primary: store.branding.primary_color ?? theme.colors.primary, accent: store.branding.accent_color ?? theme.colors.accent }} className="h-40 w-full" /> : null}
                  <div className="space-y-1 text-sm">
                    <p className="flex items-center gap-2 font-bold text-ink">
                      <Icon className="size-4 text-brand-600" aria-hidden /> {template?.name}
                    </p>
                    <p className="text-muted">{template?.tagline}</p>
                    <p className="pt-2 text-ink">{`${variant?.name} design · ${theme?.name} colours`}</p>
                    <p className="text-muted">{store.home.version ? `Home page version ${store.home.version} is live.` : "Shoppers see the design’s starting home page until you publish your own."}</p>
                  </div>
                </div>
              </Card>
              <StoreDetails key={`${store.id}:${store.theme}`} store={store} canManage={canManage} />
            </div>
          );
        }}
      </QueryView>
    </ShqShell>
  );
}
