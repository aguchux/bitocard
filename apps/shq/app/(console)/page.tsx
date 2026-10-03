"use client";

import type { ReactNode } from "react";
import { ArrowRight, CheckCircle2, Circle, Clock, ReceiptText, Store as StoreIcon, Wallet as WalletIcon, PiggyBank } from "lucide-react";
import { useAccountVerificationQuery, useResellerOrdersInfiniteQuery, useStoresQuery, useWalletQuery } from "@bitocard/api-client/reseller";
import { Card, CardHeader, DataTable, errorMessage, formatMoney, formatRelative, PageHeader, StatCard, StatusBadge } from "@bitocard/admin-ui";
import { AppLink } from "@bitocard/admin-ui/shell";
import { ShqShell } from "@/components/shq-shell";
import { can, useReseller } from "@/components/reseller";

type Step = { done: boolean; title: string; detail: string; href: string; action: string };

function Checklist({ steps }: { steps: Step[] }) {
  const remaining = steps.filter(step => !step.done).length;
  if (!remaining) return null;
  return (
    <Card>
      <CardHeader title="Get set up" description={`${steps.length - remaining} of ${steps.length} done. Store setup takes about five minutes; verification and funding can take longer.`} />
      <ol className="divide-y divide-line">
        {steps.map(step => (
          <li key={step.title} className="flex flex-wrap items-center gap-3 px-5 py-4 sm:flex-nowrap">
            {step.done ? <CheckCircle2 className="size-5 shrink-0 text-emerald-600" aria-label="Done" /> : <Circle className="size-5 shrink-0 text-subtle" aria-label="To do" />}
            <div className="min-w-0 flex-1">
              <p className={step.done ? "font-semibold text-muted line-through" : "font-semibold text-ink"}>{step.title}</p>
              <p className="text-sm text-muted">{step.detail}</p>
            </div>
            {step.done ? null : (
              <AppLink href={step.href} className="inline-flex min-h-10 items-center gap-1 rounded-lg px-3 text-sm font-semibold text-brand-600 hover:bg-brand-50">
                {step.action}
                <ArrowRight className="size-4" aria-hidden />
              </AppLink>
            )}
          </li>
        ))}
      </ol>
    </Card>
  );
}

function Money({ minor, currency, loading }: { minor: number | undefined; currency: string | undefined; loading: boolean }): ReactNode {
  if (loading) return null;
  return minor === undefined || !currency ? "—" : formatMoney(minor, currency);
}

/** The overview: what to do next, balances, and the latest orders. */
export default function HomePage() {
  const { user, membership, mode } = useReseller();
  const seesWallet = can(membership, "admin", "finance", "developer");
  const verification = useAccountVerificationQuery();
  const stores = useStoresQuery();
  const wallet = useWalletQuery(undefined, { skip: !seesWallet });
  const orders = useResellerOrdersInfiniteQuery({});
  const recent = orders.data?.pages[0]?.data.slice(0, 8);
  const store = stores.data?.data[0];
  const currency = wallet.data?.currency;

  const steps: Step[] = [
    // Accounts opened before onboarding asked for the country (sign-up and onboarding ask for it now).
    ...(membership.reseller.country
      ? []
      : [{ done: false, title: "Choose your business country", detail: "You sell in its currency. It is needed before anything else.", href: "/settings", action: "Choose" }]),
    {
      done: membership.reseller.status === "active" || Boolean(verification.data?.verified),
      title: "Verify your identity",
      detail: "A quick ID and face check. Live orders and the startup allowance need it.",
      href: "/settings/verification",
      action: "Start",
    },
    { done: Boolean(store), title: "Create your store", detail: "Choose its name and your bitocard.com address.", href: "/store", action: "Create" },
    { done: store?.status === "published", title: "Publish your store", detail: "Customers can find it once it is published.", href: "/store", action: "Publish" },
    ...(seesWallet
      ? [{ done: Boolean(wallet.data && (wallet.data.available > 0 || wallet.data.reserved > 0)), title: "Fund your wallet", detail: "Your wallet pays BitoCard's wholesale cost for each order.", href: "/wallet/top-ups", action: "Top up" }]
      : []),
  ];

  return (
    <ShqShell section="home" current="/" crumbs={[{ label: "Home" }]}>
      <PageHeader
        title={`Welcome, ${user.name.trim().split(/\s+/)[0]}`}
        description={`${membership.reseller.name}${mode === "test" ? " · Sandbox figures" : ""}`}
      />

      {verification.isLoading || stores.isLoading ? null : <Checklist steps={steps} />}

      {seesWallet ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Available" icon={<WalletIcon className="size-5" aria-hidden />} loading={wallet.isLoading} value={<Money minor={wallet.data?.available} currency={currency} loading={wallet.isLoading} />} footer={<p className="text-xs text-muted">Pays for new orders</p>} />
          <StatCard
            label="Withdrawable earnings"
            tone="green"
            icon={<PiggyBank className="size-5" aria-hidden />}
            loading={wallet.isLoading}
            value={<Money minor={wallet.data?.earnings.withdrawable} currency={currency} loading={wallet.isLoading} />}
            footer={<AppLink href="/wallet/payouts" className="text-xs font-semibold text-brand-600 hover:underline">Withdraw</AppLink>}
          />
          <StatCard
            label="Earnings on hold"
            tone="amber"
            icon={<Clock className="size-5" aria-hidden />}
            loading={wallet.isLoading}
            value={<Money minor={wallet.data?.earnings.on_hold} currency={currency} loading={wallet.isLoading} />}
            footer={<p className="text-xs text-muted">{wallet.data?.earnings.next_release_at ? `Next release ${formatRelative(wallet.data.earnings.next_release_at)}` : "Released after the payout hold"}</p>}
          />
          <StatCard label="Held for orders" tone="blue" icon={<ReceiptText className="size-5" aria-hidden />} loading={wallet.isLoading} value={<Money minor={wallet.data?.reserved} currency={currency} loading={wallet.isLoading} />} footer={<p className="text-xs text-muted">Orders in progress</p>} />
        </div>
      ) : null}
      {wallet.error ? <p className="text-sm text-red-700">{errorMessage(wallet.error)}</p> : null}

      <Card>
        <CardHeader
          title="Latest orders"
          actions={
            <AppLink href="/orders" className="inline-flex min-h-10 items-center gap-1 rounded-lg px-3 text-sm font-semibold text-brand-600 hover:bg-brand-50">
              All orders
              <ArrowRight className="size-4" aria-hidden />
            </AppLink>
          }
        />
        <DataTable
          caption="Latest orders"
          rows={recent}
          loading={orders.isLoading}
          error={orders.error ? errorMessage(orders.error) : null}
          onRetry={orders.refetch}
          rowKey={order => order.id}
          empty="No orders yet. Orders from your store, your API keys or placed here appear in this list."
          columns={[
            {
              key: "product",
              header: "Product",
              cell: order => (
                <AppLink href={`/orders/${order.id}`} className="font-semibold text-ink hover:text-brand-600">
                  {order.product.name}
                </AppLink>
              ),
            },
            { key: "when", header: "Placed", cell: order => formatRelative(order.created_at), hideOnMobile: true },
            { key: "price", header: "Customer price", align: "right", cell: order => formatMoney(order.price, order.currency) },
            { key: "profit", header: "Your profit", align: "right", cell: order => formatMoney(order.reseller_profit, order.currency), hideOnMobile: true },
            { key: "status", header: "Status", cell: order => <StatusBadge status={order.status} /> },
          ]}
        />
      </Card>

      {store?.status === "published" ? (
        <Card className="flex flex-wrap items-center gap-3 p-5">
          <StoreIcon className="size-5 text-brand-600" aria-hidden />
          <p className="min-w-0 flex-1 text-sm text-muted">
            Your store is live at{" "}
            <a href={store.url} target="_blank" rel="noreferrer" className="font-semibold break-all text-brand-600 hover:underline">
              {store.url.replace(/^https:\/\//, "")}
            </a>
          </p>
        </Card>
      ) : null}
    </ShqShell>
  );
}
