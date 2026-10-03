"use client";

import { ChevronRight } from "lucide-react";
import { Card, CardHeader, formatRelative, StatusBadge } from "@bitocard/admin-ui";
import { AppLink } from "@bitocard/admin-ui/shell";
import type { Supplier } from "@bitocard/api-client/admin";

export const healthOf = (supplier: Supplier) =>
  !supplier.enabled ? "disabled" : supplier.last_sync_error || !supplier.configured ? "degraded" : "operational";

/** Switched-on suppliers and whether their last catalogue sync worked (side panel of the product catalogue). */
export function SupplierHealth({ suppliers }: { suppliers: Supplier[] | undefined }) {
  const live = suppliers?.filter(supplier => supplier.enabled || supplier.status === "mvp_live") ?? [];
  return (
    <Card>
      <CardHeader
        title="Supplier health"
        actions={
          <AppLink href="/catalog/suppliers" className="text-sm font-semibold text-blue-600 hover:underline">
            Manage
          </AppLink>
        }
      />
      <ul className="space-y-3 p-5 sm:p-6">
        {live.map(supplier => (
          <li key={supplier.code}>
            <AppLink href={`/catalog/suppliers#${supplier.code}`} className="flex items-center gap-3 rounded-2xl border border-line p-4 hover:bg-canvas">
              <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-full bg-navy-900 font-bold text-white">
                {supplier.name.charAt(0)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{supplier.name}</span>
                <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                  <StatusBadge status={healthOf(supplier)} />
                  synced {formatRelative(supplier.last_synced_at)}
                </span>
              </span>
              <ChevronRight className="size-4 text-subtle" aria-hidden />
            </AppLink>
          </li>
        ))}
        {suppliers && !live.length ? <li className="text-sm text-muted">No suppliers switched on.</li> : null}
      </ul>
    </Card>
  );
}
