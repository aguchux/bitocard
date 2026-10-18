import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import type { StoreCheckout } from "@bitocard/api-client/storefront";
import { TicketForm } from "@/components/store/support-forms";
import { currentCustomer, customerApi } from "@/lib/customer";

export const metadata: Metadata = { title: "Ask the store", robots: { index: false, follow: false } };

/** A new question for the store, about one of the customer's orders when `?order=<checkout id>` names it. */
export default async function NewTicketPage({ searchParams }: { searchParams: Promise<{ order?: string }> }) {
  const { order: orderId } = await searchParams;
  const here = orderId ? `/account/support/new?order=${orderId}` : "/account/support/new";
  if (!(await currentCustomer())) redirect(`/signin?next=${encodeURIComponent(here)}`);
  const order = orderId ? await customerApi<StoreCheckout>("GET", `/v1/store/checkouts/${encodeURIComponent(orderId)}`) : null;
  const about = order?.ok ? order.data : null;

  return (
    <div className="mx-auto grid max-w-2xl gap-6">
      <Link href={about ? `/account/orders/${about.id}` : "/account/support"} className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-slate-600 hover:text-navy-900">
        <ChevronLeft className="size-4" aria-hidden="true" /> {about ? "Back to the order" : "Help & support"}
      </Link>
      <div>
        <h1 className="font-display text-2xl font-extrabold tracking-tight text-navy-900 sm:text-3xl">Ask the store</h1>
        <p className="mt-1 text-slate-600">
          {about ? `About your order: ${about.quantity > 1 ? `${about.quantity} × ` : ""}${about.product.name}. ` : ""}The store replies here, and we tell you when it does.
        </p>
      </div>
      <section className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">
        <TicketForm checkoutId={about?.id} />
      </section>
    </div>
  );
}
