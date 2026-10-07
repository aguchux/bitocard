import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight, LogOut } from "lucide-react";
import { formatPrice, type StoreCheckout, type StoreList } from "@bitocard/api-client/storefront";
import { NameForm, PasswordForm } from "@/components/store/account-forms";
import { StatusPill } from "@/components/store/order-status";
import { currentCustomer, customerApi } from "@/lib/customer";
import { signOut } from "./actions";

export const metadata: Metadata = { title: "Your account", robots: { index: false, follow: false } };

const date = (iso: string) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

/** The customer's orders (newest first), their details and password, and signing out. */
export default async function AccountPage() {
  const customer = await currentCustomer();
  if (!customer) redirect("/signin?next=/account");
  if (!customer.email_verified) redirect("/account/verify?next=/account");
  const orders = await customerApi<StoreList<StoreCheckout>>("GET", "/v1/store/checkouts?limit=50");

  return (
    <div className="mx-auto grid max-w-4xl gap-6 py-6 sm:py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-extrabold tracking-tight text-[#070f4c] sm:text-4xl">Your account</h1>
          <p className="mt-1 text-slate-600">{customer.email}</p>
        </div>
        <form action={signOut}>
          <button type="submit" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-4 font-semibold text-[#070f4c] hover:border-slate-300">
            <LogOut className="size-4" aria-hidden="true" /> Sign out
          </button>
        </form>
      </div>

      <section aria-labelledby="orders" className="rounded-3xl border border-slate-100 bg-white p-4 shadow-sm sm:p-6">
        <h2 id="orders" className="font-display text-xl font-bold">
          Your orders
        </h2>
        {!orders.ok ? (
          <p className="mt-3 text-sm text-red-700">{orders.message}</p>
        ) : orders.data.data.length === 0 ? (
          <p className="mt-3 text-slate-600">
            Nothing yet.{" "}
            <Link href="/catalogs" className="font-semibold text-[#2477ff] hover:underline">
              Browse the catalogue
            </Link>
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100">
            {orders.data.data.map(order => (
              <li key={order.id}>
                <Link href={`/account/orders/${order.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl px-2 py-3 hover:bg-slate-50">
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">
                      {order.quantity > 1 ? `${order.quantity} × ` : ""}
                      {order.product.name}
                    </span>
                    <span className="block text-sm text-slate-500">
                      {date(order.created_at)} · {formatPrice(order.amount, order.currency)}
                      {order.mode === "test" ? " · Test order" : ""}
                    </span>
                  </span>
                  <StatusPill status={order.status} />
                  <ChevronRight className="size-4 text-slate-400" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid gap-6 md:grid-cols-2">
        <section aria-labelledby="details" className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">
          <h2 id="details" className="font-display mb-4 text-xl font-bold">
            Your details
          </h2>
          <NameForm name={customer.name} />
          <p className="mt-4 text-sm">
            <Link href="/account/verification" className="font-semibold text-[#2477ff] hover:underline">
              Identity check
            </Link>{" "}
            <span className="text-slate-500">(needed once for some products in some countries)</span>
          </p>
        </section>
        <section aria-labelledby="password" className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">
          <h2 id="password" className="font-display mb-4 text-xl font-bold">
            Password
          </h2>
          <PasswordForm />
        </section>
      </div>
    </div>
  );
}
