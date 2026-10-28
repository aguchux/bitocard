"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card, FilterSelect, PageHeader, QueryView, Skeleton } from "@bitocard/admin-ui";
import { useP2pOrdersQuery } from "@bitocard/api-client/afrippa-admin";
import { OrdersTable } from "@/components/orders";
import { AfrippaShell } from "@/components/shell";

const modes = [
  { value: "live", label: "Live" },
  { value: "test", label: "Sandbox" },
];

/** Orders > Appeals: orders a buyer or seller appealed, oldest decision first. Operations decide each on its page. */
export default function AppealsPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"live" | "test">("live");
  const query = useP2pOrdersQuery({ mode, status: "appealed", limit: 100 });
  return (
    <AfrippaShell section="orders" current="/orders" crumbs={[{ label: "Orders", href: "/orders" }, { label: "Appeals" }]}>
      <PageHeader title="Appeals" description="Orders a trader appealed. The coins stay in escrow until operations release them to the buyer or return them to the seller, with whose fault it was." />
      <div className="mb-4 flex flex-wrap gap-3">
        <FilterSelect id="mode" label="Money" value={mode} onChange={value => setMode(value as "live" | "test")} options={modes} />
      </div>
      <Card>
        <QueryView query={query} loading={<Skeleton className="h-64" />}>
          {data => <OrdersTable orders={data.data} empty="No appeals waiting." onOpen={order => router.push(`/orders/${order.id}`)} />}
        </QueryView>
      </Card>
    </AfrippaShell>
  );
}
