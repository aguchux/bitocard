import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Link from "next/link";
import { CalendarClock, CheckCircle2, Clock, LockKeyhole, Phone, Store, XCircle } from "lucide-react";
import { categoryLabels, formatFace, type ProductCategory, type ProductFeature } from "@bitocard/api-client/storefront";
import { brand } from "@bitocard/ui/site";
import { RefreshWhile } from "@/components/store/order-status";
import { FeatureIcons } from "@/components/store/features";
import { type AccessDelivery, type AccessStore, accessApi, type OrderAccess, passPath } from "@/lib/access";
import { Codes } from "./codes";
import { EmailCodeGate } from "./gate";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

// The link opens the order: never indexed, and no Referer to other sites (it would carry the link).
export const metadata: Metadata = { title: "Your order", robots: { index: false, follow: false }, referrer: "no-referrer" };

const date = (iso: string) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(new Date(iso));
const dateTime = (iso: string) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
const secretKinds = new Set<AccessDelivery["kind"]>(["gift_card", "licence_key", "token"]);

function Shell({ store, children }: { store: AccessStore | null; children: React.ReactNode }) {
  const name = store?.name ?? brand.name;
  return (
    <div className={`${inter.variable} min-h-svh bg-[#f8f9fc] font-[family-name:var(--font-inter)] text-[#070f4c]`}>
      <header className="border-b border-slate-100 bg-white">
        <div className="mx-auto flex h-16 max-w-3xl items-center gap-3 px-4 sm:px-6">
          {store?.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element -- the store's own logo, any https host
            <img src={store.logo_url} alt="" className="size-9 rounded-lg object-contain" />
          ) : null}
          <p className="truncate text-lg font-extrabold" style={store ? { color: store.primary_color } : undefined}>
            {name}
          </p>
        </div>
      </header>
      <main id="main" className="mx-auto grid max-w-3xl gap-5 px-4 py-6 sm:px-6 sm:py-10">
        {children}
      </main>
      <footer className="px-4 pb-8 text-center text-xs text-slate-500">
        {name} · {brand.credit}
      </footer>
    </div>
  );
}

function Notice({ tone, icon, children }: { tone: string; icon: React.ReactNode; children: React.ReactNode }) {
  return <div className={`flex items-start gap-3 rounded-2xl p-4 ${tone}`}>{icon}<div className="min-w-0">{children}</div></div>;
}

/** A virtual number: the number itself (not a secret), what it can do and when it is paid up to. */
function NumberPanel({ delivery, features }: { delivery: AccessDelivery; features: string[] }) {
  const number = delivery.details.number ?? delivery.serial;
  const expires = delivery.details.expires_at;
  return (
    <section aria-labelledby="number" className="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm sm:p-6">
      <h2 id="number" className="flex items-center gap-2 text-xl font-bold">
        <Phone className="size-5 text-[#ff2382]" aria-hidden="true" /> Your number
      </h2>
      {number ? <p className="mt-3 font-mono text-2xl font-extrabold tracking-wide sm:text-3xl">{number}</p> : null}
      {expires && !Number.isNaN(Date.parse(expires)) ? (
        <p className="mt-2 flex items-center gap-2 text-sm text-slate-600">
          <CalendarClock className="size-4" aria-hidden="true" /> Paid up to {date(expires)}. Renew before then to keep it: a number not renewed within 15 days of that date is deleted.
        </p>
      ) : null}
      {features.length ? (
        <div className="mt-5">
          <p className="mb-2 text-sm font-semibold">What it can do</p>
          <FeatureIcons features={features as ProductFeature[]} />
        </div>
      ) : null}
      <p className="mt-5 text-sm text-slate-500">Some apps and services do not accept virtual numbers.</p>
    </section>
  );
}

/**
 * An order's page (`/a/<token>`), under the store's brand. The link only points at the order: it shows only to the
 * customer who proves it is theirs (signed in at the store it was bought from, or a code emailed to the order's
 * address); until then, nothing but the store's name. What it shows depends on the product: codes and keys behind
 * Reveal, a virtual number with what it can do, or the confirmation of a top-up or bill sent to a phone or account.
 */
export default async function OrderAccessPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const result = await accessApi<OrderAccess>(token);
  if (!result.ok) {
    const missing = result.status === 404;
    return (
      <Shell store={null}>
        <h1 className="text-2xl font-extrabold tracking-tight">{missing ? "This link is not valid" : "We could not load this order"}</h1>
        <p className="text-slate-600">{missing ? "It may have been replaced. Ask the store that sold it for a new link." : "Try again in a moment."}</p>
      </Shell>
    );
  }
  const { store, access } = result.data;
  if (!result.data.order) {
    return (
      <Shell store={store}>
        {access.method === "email" && access.email_hint ? (
          <EmailCodeGate token={token} emailHint={access.email_hint} />
        ) : access.method === "customer" ? (
          <section className="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm sm:p-6">
            <h1 className="flex items-center gap-2 text-xl font-bold">
              <LockKeyhole className="size-5 text-[#ff2382]" aria-hidden="true" /> Sign in to see your order
            </h1>
            <p className="mt-2 text-slate-600">Only the account that bought this order can open it. Sign in to {store.name} with that account.</p>
            <Link href={`/signin?next=${encodeURIComponent(passPath(token))}`} className="mt-5 inline-flex min-h-12 items-center justify-center rounded-xl bg-[#070f4c] px-5 font-semibold text-white hover:bg-[#0b1766]">
              Sign in
            </Link>
          </section>
        ) : (
          <section className="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm sm:p-6">
            <h1 className="flex items-center gap-2 text-xl font-bold">
              <Store className="size-5 text-[#ff2382]" aria-hidden="true" /> Your order is with {store.name}
            </h1>
            <p className="mt-2 text-slate-600">{store.name} delivers this order to you directly. Contact them for your codes and its details.</p>
          </section>
        )}
        <p className="text-center text-xs text-slate-500">This page shows an order only to the customer who bought it.</p>
      </Shell>
    );
  }

  const order = result.data.order;
  const category = order.product.category as ProductCategory;
  const codes = order.deliveries.filter(delivery => secretKinds.has(delivery.kind));
  const numbers = order.deliveries.filter(delivery => delivery.kind === "virtual_number");
  const sentTo = order.recipient.phone ?? order.recipient.account_number;

  return (
    <Shell store={store}>
      <RefreshWhile active={order.status === "processing"} />
      <div>
        <p className="text-sm font-semibold text-slate-500">{categoryLabels[category] ?? "Order"}</p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">
          {order.quantity > 1 ? `${order.quantity} × ` : ""}
          {order.product.name}
        </h1>
        <p className="mt-1 text-slate-600">
          {formatFace(order.face_value, order.face_currency)}
          {order.quantity > 1 ? " each" : ""} · ordered {dateTime(order.created_at)}
        </p>
      </div>

      {order.mode === "test" ? <p className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-900">This is a test order: nothing was charged and the codes are not real.</p> : null}

      {order.status === "processing" ? (
        <Notice tone="bg-blue-50 text-blue-900" icon={<Clock className="mt-0.5 size-5 shrink-0" aria-hidden="true" />}>
          <p className="font-semibold">On its way</p>
          <p className="text-sm">We are completing your order. This page updates by itself.</p>
        </Notice>
      ) : null}
      {order.status === "failed" ? (
        <Notice tone="bg-slate-100 text-slate-800" icon={<XCircle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />}>
          <p className="font-semibold">This order could not be completed</p>
          <p className="text-sm">Contact {store.name} about a refund if you were charged.</p>
        </Notice>
      ) : null}
      {order.status === "refunded" ? (
        <Notice tone="bg-slate-100 text-slate-800" icon={<XCircle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />}>
          <p className="font-semibold">This order was refunded</p>
          <p className="text-sm">Its codes can no longer be shown.</p>
        </Notice>
      ) : null}

      {order.status === "completed" ? (
        <>
          <Notice tone="bg-emerald-50 text-emerald-900" icon={<CheckCircle2 className="mt-0.5 size-5 shrink-0" aria-hidden="true" />}>
            <p className="font-semibold">Delivered{order.completed_at ? ` ${dateTime(order.completed_at)}` : ""}</p>
            {sentTo && !codes.length && !numbers.length ? (
              <p className="text-sm">
                Sent to {sentTo}
                {order.recipient.account_name ? ` (${order.recipient.account_name})` : ""}.
              </p>
            ) : null}
          </Notice>
          {codes.length ? <Codes token={token} deliveries={codes} instructions={order.redeem_instructions} /> : null}
          {numbers.map((delivery, index) => (
            <NumberPanel key={index} delivery={delivery} features={order.product.features} />
          ))}
          {order.deliveries.some(delivery => delivery.kind === "confirmation" && delivery.details.transaction_id) ? (
            <p className="text-sm text-slate-600">Transaction reference: {order.deliveries.find(delivery => delivery.details.transaction_id)?.details.transaction_id}</p>
          ) : null}
        </>
      ) : null}

      <p className="text-center text-xs text-slate-500">Only you can open this order. We email you when its codes are shown.</p>
    </Shell>
  );
}
