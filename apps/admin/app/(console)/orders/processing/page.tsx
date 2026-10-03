"use client";

import { PageHeader } from "@bitocard/admin-ui";
import { AdminShell } from "@bitocard/admin-ui/shell";
import { OrderList } from "../order-list";

export default function Page() {
  return (
    <AdminShell section="orders" current="/orders/processing" crumbs={[{ label: "Orders", href: "/orders" }, { label: "Processing" }]}>
      <PageHeader title="Processing" description="Orders waiting for the supplier to confirm. They are checked again automatically." />
      <OrderList status="processing" empty="Nothing is processing right now." />
    </AdminShell>
  );
}
