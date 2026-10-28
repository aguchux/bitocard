"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Card, FilterSelect, PageHeader, QueryView, Skeleton } from "@bitocard/admin-ui";
import { type P2pOrderStatus, useP2pOrdersQuery } from "@bitocard/api-client/afrippa-admin";
import { orderStatus, OrdersTable } from "@/components/orders";
import { AfrippaShell } from "@/components/shell";

const statuses = [{ value: "", label: "Every status" }, ...Object.entries(orderStatus).map(([value, [label]]) => ({ value, label }))];

/** Orders > All orders: every order, by status and money; a trader's own (`?customer=`) from their wallet page. */
export default function AllOrdersPage() {
  // useSearchParams needs a Suspense boundary (a trader's page links here with ?customer=<id>).
  return (
    <Suspense>
      <AllOrders />
    </Suspense>
  );
}

function AllOrders() {
  const router = useRouter();
  const customer = useSearchParams().get("customer") ?? undefined;
  const [mode, setMode] = useState<"live" | "test">("live");
  const [status, setStatus] = useState("");
  const query = useP2pOrdersQuery({ mode, ...(status ? { status: status as P2pOrderStatus } : {}), ...(customer ? { customer_id: customer } : {}), limit: 200 });
  return (
    <AfrippaShell section="orders" current="/orders/all" crumbs={[{ label: "Orders", href: "/orders" }, { label: "All orders" }]}>
      <PageHeader title={customer ? "A trader's orders" : "All orders"} description="Escrow orders, newest first: open ones waiting for payment or release, and those closed." />
      <div className="mb-4 flex flex-wrap gap-3">
        <FilterSelect
          id="mode"
          label="Money"
          value={mode}
          onChange={value => setMode(value as "live" | "test")}
          options={[
            { value: "live", label: "Live" },
            { value: "test", label: "Sandbox" },
          ]}
        />
        <FilterSelect id="status" label="Status" value={status} onChange={setStatus} options={statuses} />
      </div>
      <Card>
        <QueryView query={query} loading={<Skeleton className="h-64" />}>
          {data => <OrdersTable orders={data.data} empty="No orders." onOpen={order => router.push(`/orders/${order.id}`)} />}
        </QueryView>
      </Card>
    </AfrippaShell>
  );
}
