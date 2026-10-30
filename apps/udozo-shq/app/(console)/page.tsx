"use client";

import { useState, useSyncExternalStore, type ReactNode } from "react";
import { ArrowRight, CheckCircle2, Circle, Clock, ShoppingBag, Store as StoreIcon, Wallet as WalletIcon, PiggyBank, X } from "lucide-react";
import { useAccountVerificationQuery, useResaleOrdersQuery, useSetupFeeQuery, useStoresQuery, useWalletQuery } from "@bitocard/api-client/reseller";
import { Button, Card, CardHeader, DataTable, errorMessage, formatMoney, formatRelative, PageHeader, StatCard } from "@bitocard/admin-ui";
import { AppLink } from "@bitocard/admin-ui/shell";
import { ShqShell } from "@/components/shq-shell";
import { can, useReseller } from "@/components/reseller";
import { ResaleOrderBadge } from "@/components/resale";

type Step = { id: string; done: boolean; title: string; detail: string; href: string; action: string };

const dismissKey = (resellerId: string) => `udozo-shq.checklist.dismissed.${resellerId}`;
const dismissedHere = (resellerId: string) => {
  try {
    return window.localStorage.getItem(dismissKey(resellerId)) === "1";
  } catch {
    return false;
  }
};
// Another tab dismissing it hides it here too.
const onStorage = (changed: () => void) => {
  window.addEventListener("storage", changed);
  return () => window.removeEventListener("storage", changed);
};

/**
 * What is left to set up. Once going live is the only step left, the seller may hide the list: it is remembered in
 * this browser for the account, and comes back if another step needs doing again.
 */
function Checklist({ steps, resellerId }: { steps: Step[]; resellerId: string }) {
  const left = steps.filter(step => !step.done);
  const onlyLive = left.length === 1 && left[0].id === "live";
  // Null on the server, so a list this browser hid never flashes before the choice is read.
  const remembered = useSyncExternalStore(
    onStorage,
    () => dismissedHere(resellerId),
    () => null,
  );
  const [hidden, setHidden] = useState(false);
  if (!left.length || (onlyLive && (hidden || remembered !== false))) return null;
  const dismiss = () => {
    try {
      window.localStorage.setItem(dismissKey(resellerId), "1");
    } catch {
      /* hidden for this visit only */
    }
    setHidden(true);
  };
  return (
    <Card>
      <CardHeader
        title="Get set up"
        description={`${steps.length - left.length} of ${steps.length} done. Store setup takes about five minutes; verification and your domain can take longer.`}
        actions={
          onlyLive ? (
            <Button variant="ghost" size="sm" icon={<X className="size-4" aria-hidden />} onClick={dismiss} aria-label="Dismiss the set-up checklist">
              Dismiss
            </Button>
          ) : null
        }
      />
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

/** Resale orders still open: the supplier has to accept, hand over or ship, or the buyer has to confirm. */
const openStatuses = new Set(["locked", "paid", "sent", "disputed"]);

/** The overview: what to do next, the wallet, your stores and the resale orders waiting. */
export default function HomePage() {
  const { user, membership, mode } = useReseller();
  const seesWallet = can(membership, "admin", "finance", "developer");
  const verification = useAccountVerificationQuery();
  const stores = useStoresQuery();
  const setupFee = useSetupFeeQuery();
  const wallet = useWalletQuery(undefined, { skip: !seesWallet });
  const orders = useResaleOrdersQuery({ limit: 25 });
  const waiting = orders.data?.data.filter(order => openStatuses.has(order.status));
  const all = stores.data?.data ?? [];
  // The checklist follows the first live store, else the first published one, else the first.
  const store = all.find(item => item.checkout_mode === "live") ?? all.find(item => item.status === "published") ?? all[0];
  const live = store?.checkout_mode === "live";
  const currency = wallet.data?.currency;

  const steps: Step[] = [
    // Accounts opened before onboarding asked for the country (sign-up and onboarding ask for it now).
    ...(membership.reseller.country
      ? []
      : [{ id: "country", done: false, title: "Choose your business country", detail: "You sell in its currency, to shoppers of that country. It is needed before anything else.", href: "/settings", action: "Choose" }]),
    {
      id: "verify",
      done: membership.reseller.status === "active" || Boolean(verification.data?.verified),
      title: "Verify your business",
      detail: "An ID and face check, and your business's documents if it is registered. Going live needs it.",
      href: "/settings/verification",
      action: "Start",
    },
    { id: "store", done: Boolean(store), title: "Create your store", detail: "A Resale shop with its design and colours, on a udozo.com address to test it.", href: store ? "/store" : "/store/new", action: "Create" },
    { id: "listings", done: live, title: "Add listings to sell", detail: "Choose suppliers' listings in your country and set your prices within their limits.", href: "/resale", action: "Browse" },
    { id: "domain", done: live, title: "Give your store its own domain", detail: "A live store runs on its own domain. Premium includes one free; or buy or connect one.", href: "/store/domains", action: "Set up" },
    ...(setupFee.data?.charged ? [{ id: "setup_fee", done: !setupFee.data.due, title: "Pay the Seller HQ setup fee", detail: "Once, from your wallet, or with your first Premium month.", href: "/settings/plan", action: "Pay" }] : []),
    { id: "live", done: live, title: "Take your store live", detail: "Shoppers then pay real money on your own domain.", href: store ? `/store/${store.id}` : "/store", action: "Go live" },
  ];

  return (
    <ShqShell section="home" current="/" crumbs={[{ label: "Home" }]}>
      <PageHeader title={`Welcome, ${user.name.trim().split(/\s+/)[0]}`} description={`${membership.reseller.name}${mode === "test" ? " · Sandbox figures" : ""}`} />

      {verification.isLoading || stores.isLoading || setupFee.isLoading ? null : <Checklist steps={steps} resellerId={membership.reseller.id} />}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {seesWallet ? (
          <>
            <StatCard
              label="Available"
              icon={<WalletIcon className="size-5" aria-hidden />}
              loading={wallet.isLoading}
              value={<Money minor={wallet.data?.available} currency={currency} loading={wallet.isLoading} />}
              footer={<p className="text-xs text-muted">Pays for Premium, domains and the setup fee</p>}
            />
            <StatCard
              label="Withdrawable earnings"
              tone="green"
              icon={<PiggyBank className="size-5" aria-hidden />}
              loading={wallet.isLoading}
              value={<Money minor={wallet.data?.earnings.withdrawable} currency={currency} loading={wallet.isLoading} />}
              footer={
                <AppLink href="/wallet/payouts" className="text-xs font-semibold text-brand-600 hover:underline">
                  Withdraw
                </AppLink>
              }
            />
            <StatCard
              label="Earnings on hold"
              tone="amber"
              icon={<Clock className="size-5" aria-hidden />}
              loading={wallet.isLoading}
              value={<Money minor={wallet.data?.earnings.on_hold} currency={currency} loading={wallet.isLoading} />}
              footer={<p className="text-xs text-muted">{wallet.data?.earnings.next_release_at ? `Next release ${formatRelative(wallet.data.earnings.next_release_at)}` : "Released after the payout hold"}</p>}
            />
          </>
        ) : null}
        <StatCard
          label="Your stores"
          tone="blue"
          icon={<StoreIcon className="size-5" aria-hidden />}
          loading={stores.isLoading}
          value={stores.isLoading ? null : String(all.length)}
          footer={<p className="text-xs text-muted">{`${all.filter(item => item.checkout_mode === "live").length} live`}</p>}
        />
      </div>
      {wallet.error ? <p className="text-sm text-red-700">{errorMessage(wallet.error)}</p> : null}

      <Card>
        <CardHeader
          title="Orders waiting"
          description="Resale orders still open: waiting for the supplier to accept or hand over, or for the buyer to confirm."
          actions={
            <AppLink href="/resale/orders" className="inline-flex min-h-10 items-center gap-1 rounded-lg px-3 text-sm font-semibold text-brand-600 hover:bg-brand-50">
              All orders
              <ArrowRight className="size-4" aria-hidden />
            </AppLink>
          }
        />
        <DataTable
          caption="Orders waiting"
          rows={waiting}
          loading={orders.isLoading}
          error={orders.error ? errorMessage(orders.error) : null}
          onRetry={orders.refetch}
          rowKey={order => order.id}
          empty="No orders waiting. Orders from your stores appear here until they are complete."
          columns={[
            {
              key: "listing",
              header: "Listing",
              cell: order => (
                <AppLink href={`/resale/orders/${order.id}`} className="font-semibold text-ink hover:text-brand-600">
                  {order.listing.title}
                </AppLink>
              ),
            },
            { key: "number", header: "Order", cell: order => order.number, hideOnMobile: true },
            { key: "when", header: "Bought", cell: order => formatRelative(order.created_at), hideOnMobile: true },
            { key: "price", header: "Price", align: "right", cell: order => formatMoney(order.price, order.currency) },
            { key: "status", header: "Now", cell: order => <ResaleOrderBadge status={order.status} /> },
          ]}
        />
      </Card>

      {store && live ? (
        <Card className="flex flex-wrap items-center gap-3 p-5">
          <ShoppingBag className="size-5 text-brand-600" aria-hidden />
          <p className="min-w-0 flex-1 text-sm text-muted">
            {store.name} is live at{" "}
            <a href={store.url} target="_blank" rel="noreferrer" className="font-semibold break-all text-brand-600 hover:underline">
              {store.url.replace(/^https:\/\//, "")}
            </a>
          </p>
        </Card>
      ) : null}
    </ShqShell>
  );
}
