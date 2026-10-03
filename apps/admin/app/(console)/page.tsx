"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, BarChart3, ShieldCheck, ShoppingCart, Truck, Users, Wallet } from "lucide-react";
import {
  Card,
  CardHeader,
  cn,
  DataTable,
  ErrorState,
  formatMoney,
  formatNumber,
  formatRelative,
  formatShortDate,
  LineChart,
  percentChange,
  Select,
  StatCard,
  StatusBadge,
  Tabs,
  Trend,
  categoryName,
  formatDateTime,
  errorMessage,
} from "@bitocard/admin-ui";
import { AdminShell, ModeSwitch, useAdmin, useMode, AppLink } from "@bitocard/admin-ui/shell";
import { type Overview, useOverviewQuery } from "@bitocard/api-client/admin";

const periods = [
  { value: "7", label: "7D" },
  { value: "30", label: "30D" },
  { value: "90", label: "90D" },
  { value: "365", label: "1Y" },
] as const;

function greeting(hour: number) {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function AttentionStrip({ attention }: { attention: Overview["attention"] }) {
  const items = [
    { count: attention.orders_needing_review, label: "orders need review", href: "/orders/review", icon: AlertTriangle },
    { count: attention.verifications_in_review, label: "identity checks to decide", href: "/verifications", icon: ShieldCheck },
    { count: attention.supplier_problems, label: "suppliers need attention", href: "/catalog/suppliers", icon: Truck },
  ].filter(item => item.count > 0);
  if (!items.length) return null;
  return (
    <div className="flex flex-wrap gap-3" role="status" aria-label="Needs attention">
      {items.map(item => (
        <AppLink key={item.href} href={item.href} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 text-sm font-medium text-amber-900 hover:bg-amber-100">
          <item.icon className="size-4" aria-hidden />
          <span className="font-bold">{item.count}</span> {item.label}
          <ArrowRight className="size-4" aria-hidden />
        </AppLink>
      ))}
    </div>
  );
}

export default function OverviewPage() {
  const admin = useAdmin();
  const { mode } = useMode();
  const [days, setDays] = useState<(typeof periods)[number]["value"]>("30");
  const [chosenCurrency, setCurrency] = useState<string | null>(null);
  const { data, error, isLoading, isFetching, refetch } = useOverviewQuery({ days: Number(days), mode });
  // The hour is only known in the browser; the page is client-rendered behind the session check.
  const [hour] = useState(() => new Date().getHours());

  const currency = chosenCurrency && data?.currencies.includes(chosenCurrency) ? chosenCurrency : (data?.currencies[0] ?? data?.wallet_float[0]?.currency ?? "NGN");
  const total = data?.totals.find(item => item.currency === currency);
  const orders = data?.totals.reduce((sum, item) => sum + item.orders, 0) ?? 0;
  const previousOrders = data?.totals.reduce((sum, item) => sum + item.previous_orders, 0) ?? 0;
  const float = data?.wallet_float.find(item => item.currency === currency);
  const series = data?.series.find(item => item.currency === currency);
  const chart = useMemo(
    () =>
      series
        ? {
            labels: series.points.map(point => formatShortDate(point.date)),
            series: [
              { name: `Gross sales (${currency})`, color: "#ff2382", values: series.points.map(point => point.gross), format: (value: number) => formatMoney(value, currency, { compact: true }) },
              { name: "Orders", color: "#2563eb", values: series.points.map(point => point.orders), format: (value: number) => formatNumber(Math.round(value)), axis: "right" as const },
            ],
          }
        : null,
    [series, currency],
  );

  return (
    <AdminShell section="home" current="/" crumbs={[{ label: "Dashboard", href: "/" }, { label: "Overview" }]} actions={<ModeSwitch />}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
            {greeting(hour)}, {admin.name.split(" ")[0]}
          </h1>
          <p className="mt-1 text-lg text-muted">Here’s what’s happening across your reseller network.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {data && data.currencies.length > 1 ? (
            <Select aria-label="Currency" value={currency} onChange={event => setCurrency(event.target.value)} className="w-auto">
              {data.currencies.map(item => (
                <option key={item}>{item}</option>
              ))}
            </Select>
          ) : null}
          <Tabs label="Period" variant="pills" value={days} onChange={setDays} items={periods.map(period => ({ value: period.value, label: period.label }))} />
        </div>
      </div>

      {error ? (
        <Card>
          <ErrorState message={errorMessage(error, "Could not load the overview.")} onRetry={refetch} />
        </Card>
      ) : (
        <>
          {data ? <AttentionStrip attention={data.attention} /> : null}
          <div className={cn("grid gap-4 sm:grid-cols-2 xl:grid-cols-4", isFetching && !isLoading && "opacity-70 transition-opacity")}>
            <StatCard
              loading={isLoading}
              label="Gross sales"
              icon={<BarChart3 />}
              tone="pink"
              value={formatMoney(total?.gross ?? 0, currency)}
              footer={<Trend change={percentChange(total?.gross ?? 0, total?.previous_gross ?? 0)} />}
            />
            <StatCard loading={isLoading} label="Orders" icon={<ShoppingCart />} tone="blue" value={formatNumber(orders)} footer={<Trend change={percentChange(orders, previousOrders)} />} />
            <StatCard
              loading={isLoading}
              label="Wallet float"
              icon={<Wallet />}
              tone="violet"
              value={formatMoney(float?.amount ?? 0, currency)}
              footer={<p className="text-xs text-muted">Held for resellers right now</p>}
            />
            <StatCard
              loading={isLoading}
              label="Active resellers"
              icon={<Users />}
              tone="green"
              value={formatNumber(data?.resellers.active ?? 0)}
              footer={<p className="text-xs text-muted">{`${data?.resellers.joined ?? 0} joined · ${data?.resellers.pending ?? 0} pending`}</p>}
            />
          </div>

          <div className="grid gap-6 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHeader title="Sales overview" description={`Daily completed sales, ${mode === "test" ? "sandbox" : "live"}`} />
              <div className="px-3 pb-5 sm:px-5">
                {chart && orders > 0 ? (
                  <LineChart label={`Daily gross sales and orders in ${currency}`} labels={chart.labels} series={chart.series} />
                ) : (
                  <p className="px-3 py-16 text-center text-sm text-muted">{isLoading ? "Loading…" : "No completed sales in this period yet."}</p>
                )}
                {chart ? (
                  <div className="mt-2 flex flex-wrap gap-4 px-3 text-sm text-muted">
                    {chart.series.map(item => (
                      <span key={item.name} className="inline-flex items-center gap-2">
                        <span className="size-2.5 rounded-full" style={{ background: item.color }} />
                        {item.name}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            </Card>

            <Card>
              <CardHeader
                title="Supplier status"
                actions={
                  <AppLink href="/catalog/suppliers" className="text-sm font-semibold text-blue-600 hover:underline">
                    View all
                  </AppLink>
                }
              />
              <ul className="divide-y divide-line px-5 pb-3 sm:px-6">
                {data?.suppliers.map(supplier => (
                  <li key={supplier.code} className="flex items-center gap-3 py-3.5">
                    <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-xl bg-navy-900 text-sm font-bold text-white">
                      {supplier.name.charAt(0)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{supplier.name}</p>
                      <p className="truncate text-xs text-muted" title={supplier.last_sync_error ?? undefined}>
                        {supplier.categories.map(categoryName).join(", ")} · synced {formatRelative(supplier.last_synced_at)}
                      </p>
                    </div>
                    <StatusBadge status={supplier.health} />
                  </li>
                ))}
                {data && !data.suppliers.length ? <li className="py-6 text-center text-sm text-muted">No suppliers switched on.</li> : null}
              </ul>
            </Card>
          </div>

          <Card>
            <CardHeader
              title="Recent orders"
              actions={
                <AppLink href="/orders" className="inline-flex items-center gap-1 text-sm font-semibold text-blue-600 hover:underline">
                  View all orders <ArrowRight className="size-4" aria-hidden />
                </AppLink>
              }
            />
            <div className="mt-4">
              <DataTable
                caption="Recent orders"
                rows={data?.recent_orders}
                loading={isLoading}
                rowKey={order => order.id}
                empty="No orders yet."
                columns={[
                  {
                    key: "order",
                    header: "Order",
                    cell: order => (
                      <AppLink href={`/orders/${order.id}`} className="font-mono text-sm font-semibold text-ink hover:text-brand-600">
                        {order.receipt_number ?? `#${order.id.slice(0, 8)}`}
                      </AppLink>
                    ),
                  },
                  { key: "reseller", header: "Reseller", cell: order => order.reseller.name },
                  {
                    key: "product",
                    header: "Product",
                    cell: order => (
                      <span>
                        <span className="font-medium">{order.product.name}</span>
                        <span className="block text-xs text-muted">{`${categoryName(order.product.category)} · ${order.product.country}`}</span>
                      </span>
                    ),
                    hideOnMobile: true,
                  },
                  { key: "amount", header: "Amount", align: "right", cell: order => formatMoney(order.price, order.currency) },
                  { key: "status", header: "Status", cell: order => <StatusBadge status={order.needs_review ? "needs_review" : order.status} /> },
                  { key: "time", header: "Time", cell: order => <span className="text-muted">{formatDateTime(order.created_at)}</span>, hideOnMobile: true },
                ]}
              />
            </div>
          </Card>
        </>
      )}
    </AdminShell>
  );
}
