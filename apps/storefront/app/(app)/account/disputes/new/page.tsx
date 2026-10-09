import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import type { StoreCheckout } from "@bitocard/api-client/storefront";
import { DisputeForm } from "@/components/store/dispute-forms";
import { currentCustomer, customerApi } from "@/lib/customer";
import { canDispute } from "@/lib/disputes";

export const metadata: Metadata = { title: "Report a problem", robots: { index: false, follow: false } };

/** Report a problem with one of the customer's orders (`?order=<checkout id>`). */
export default async function NewDisputePage({ searchParams }: { searchParams: Promise<{ order?: string }> }) {
  const { order: id } = await searchParams;
  if (!id) redirect("/account/orders");
  if (!(await currentCustomer())) redirect(`/signin?next=${encodeURIComponent(`/account/disputes/new?order=${id}`)}`);
  const result = await customerApi<StoreCheckout>("GET", `/v1/store/checkouts/${encodeURIComponent(id)}`);
  if (!result.ok) notFound();
  const order = result.data;

  return (
    <div className="mx-auto grid max-w-2xl gap-6">
      <Link href={`/account/orders/${order.id}`} className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-slate-600 hover:text-[#070f4c]">
        <ChevronLeft className="size-4" aria-hidden="true" /> Back to the order
      </Link>
      <div>
        <h1 className="font-display text-2xl font-extrabold tracking-tight text-[#070f4c] sm:text-3xl">Report a problem</h1>
        <p className="mt-1 text-slate-600">
          About your order: {order.quantity > 1 ? `${order.quantity} × ` : ""}
          {order.product.name}. The store will reply here, and can pass it to BitoCard if it needs to.
        </p>
      </div>
      {canDispute(order.status) ? (
        <section className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">
          <DisputeForm checkoutId={order.id} />
        </section>
      ) : (
        <p className="rounded-2xl bg-slate-50 p-4 text-slate-700">This order has not been paid yet, so there is nothing to dispute. If you paid, the order page updates by itself.</p>
      )}
    </div>
  );
}
