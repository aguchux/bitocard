"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { Badge, Button, Card, CardHeader, categoryName, ErrorState, errorMessage, formatMoney, formatRelative, humanise, KeyValue, Notice, PageHeader, Skeleton, StatusBadge, Tabs, Toggle } from "@bitocard/admin-ui";
import { AdminShell, can, useAdmin } from "@bitocard/admin-ui/shell";
import { type Supplier, useSuppliersQuery, useSyncSupplierMutation, useUpdateSupplierMutation } from "@bitocard/api-client/admin";
import { healthOf } from "../supplier-health";

type Filter = "live" | "all";

function SupplierCard({ supplier }: { supplier: Supplier }) {
  const admin = useAdmin();
  const operator = can(admin, "operations");
  const [update, updateState] = useUpdateSupplierMutation();
  const [sync, syncState] = useSyncSupplierMutation();
  const funding = supplier.funding;
  const minimum = (value: number | null) => (value === null ? "Unknown" : funding.currency ? formatMoney(value, funding.currency) : String(value));

  return (
    <Card as="article">
      <div id={supplier.code} className="scroll-mt-24" />
      <CardHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {supplier.name}
            <StatusBadge status={healthOf(supplier)} />
            <Badge dot={false} tone="blue">
              {humanise(supplier.status)}
            </Badge>
          </span>
        }
        description={`${supplier.categories.map(categoryName).join(", ")} · ${supplier.coverage}`}
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              icon={<RefreshCw className="size-4" aria-hidden />}
              loading={syncState.isLoading}
              disabled={!operator || !supplier.configured}
              title={supplier.configured ? undefined : "No API credentials configured"}
              onClick={() => sync(supplier.code)}
            >
              Sync catalogue
            </Button>
            <span className="flex items-center gap-2 text-sm font-medium">
              Switched on
              <Toggle label={`${supplier.name} switched on`} checked={supplier.enabled} disabled={!operator || updateState.isLoading} onChange={enabled => update({ code: supplier.code, enabled })} />
            </span>
          </>
        }
      />
      <div className="space-y-4 p-5 sm:p-6">
        {syncState.data ? (
          <Notice tone="green">{`Synced: ${syncState.data.products_created} new products, ${syncState.data.offers_updated} offers updated, ${syncState.data.offers_withdrawn} withdrawn.`}</Notice>
        ) : null}
        {syncState.error || updateState.error ? <Notice tone="red">{errorMessage(syncState.error ?? updateState.error)}</Notice> : null}
        {supplier.last_sync_error ? <Notice tone="amber" title="Last sync failed">{supplier.last_sync_error}</Notice> : null}
        {!supplier.configured ? <Notice tone="amber">No API credentials are configured, so it serves the sandbox only.</Notice> : null}
        <KeyValue
          items={[
            { label: "Last synced", value: formatRelative(supplier.last_synced_at) },
            { label: "Billing", value: funding.billing_model ? humanise(funding.billing_model) : "Unknown" },
            { label: "Minimum first deposit", value: minimum(funding.min_first_deposit_minor) },
            { label: "Minimum top-up", value: minimum(funding.min_top_up_minor) },
            { label: "Resale to resellers", value: funding.resale_approved ? "Approved in writing" : "Not confirmed" },
            { label: "IP allowlisting", value: supplier.requires_ip_allowlist === null ? "Unknown" : supplier.requires_ip_allowlist ? "Required" : "Not required" },
          ]}
        />
        {supplier.notes ? <p className="text-sm text-muted">{supplier.notes}</p> : null}
      </div>
    </Card>
  );
}

export default function SuppliersPage() {
  const { data, error, isLoading, refetch } = useSuppliersQuery();
  const [filter, setFilter] = useState<Filter>("live");
  const suppliers = data?.data.filter(supplier => filter === "all" || supplier.enabled || supplier.status === "mvp_live");

  return (
    <AdminShell section="catalog" current="/catalog/suppliers" crumbs={[{ label: "Catalog", href: "/catalog" }, { label: "Suppliers" }]}>
      <PageHeader title="Suppliers" description="Every supplier in the registry, its funding profile, and whether BitoCard uses it. Which suppliers are live is configuration, not code." />
      <Tabs
        label="Show"
        value={filter}
        onChange={setFilter}
        items={[
          { value: "live", label: "In use" },
          { value: "all", label: "Whole registry", count: data?.data.length },
        ]}
      />
      {error ? (
        <Card>
          <ErrorState message={errorMessage(error)} onRetry={refetch} />
        </Card>
      ) : isLoading || !suppliers ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <div className="grid gap-6 xl:grid-cols-2">
          {suppliers.map(supplier => (
            <SupplierCard key={supplier.code} supplier={supplier} />
          ))}
        </div>
      )}
    </AdminShell>
  );
}
