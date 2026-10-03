"use client";

import { PageHeader } from "@bitocard/admin-ui";
import { AdminShell } from "@bitocard/admin-ui/shell";
import { OrderList } from "../order-list";

export default function Page() {
  return (
    <AdminShell section="orders" current="/orders/review" crumbs={[{ label: "Orders", href: "/orders" }, { label: "Exception queue" }]}>
      <PageHeader title="Exception queue" description="Orders whose supplier outcome is still unclear after every scheduled check. Confirm with the supplier, then resolve each one." />
      <OrderList needsReview status="processing" empty="No orders need review." />
    </AdminShell>
  );
}
