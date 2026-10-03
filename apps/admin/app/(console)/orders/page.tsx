"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { PageHeader, Tabs } from "@bitocard/admin-ui";
import { AdminShell } from "@bitocard/admin-ui/shell";
import type { OrderStatus } from "@bitocard/api-client/admin";
import { OrderList } from "./order-list";

type Filter = "all" | OrderStatus;

function AllOrders() {
  const resellerId = useSearchParams().get("reseller") ?? undefined;
  const [status, setStatus] = useState<Filter>("all");
  return (
    <>
      <PageHeader
        title={resellerId ? "Orders for one reseller" : "Orders"}
        description="Every order across the network, live and sandbox. Codes and tokens are never shown here."
      />
      <Tabs
        label="Status"
        value={status}
        onChange={setStatus}
        items={[
          { value: "all", label: "All" },
          { value: "processing", label: "Processing" },
          { value: "completed", label: "Completed" },
          { value: "failed", label: "Failed" },
          { value: "refunded", label: "Refunded" },
        ]}
      />
      <OrderList status={status === "all" ? undefined : status} resellerId={resellerId} empty="No orders match these filters." />
    </>
  );
}

export default function OrdersPage() {
  return (
    <AdminShell section="orders" current="/orders" crumbs={[{ label: "Orders", href: "/orders" }, { label: "All orders" }]}>
      <Suspense>
        <AllOrders />
      </Suspense>
    </AdminShell>
  );
}
