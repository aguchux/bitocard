import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { regionWord } from "@bitocard/api-client/classifieds";
import { WantedForm } from "@/components/wanted-form";
import { requireCustomer, sellReference } from "@/lib/account";
import { marketFor } from "@/lib/api";
import { channelsFor } from "@/lib/whatsapp";

export const metadata: Metadata = { title: "Post a request", robots: { index: false, follow: true } };

/**
 * Post a request (wanted requests, docs/UDOZO_WHATSAPP_PLAN.md): a signed-in buyer says what they need, and Udozo shows
 * what may fit and tells sellers of it. Only in their own market, while requests are open there.
 */
export default async function PostRequestPage({ params }: { params: Promise<{ cc: string }> }) {
  const { cc } = await params;
  const market = await marketFor(cc);
  if (!market) notFound();
  const customer = await requireCustomer(`/${cc.toLowerCase()}/wanted/new`);
  const [channels, reference] = await Promise.all([channelsFor(market.country), sellReference(market.country)]);
  const own = customer.country === market.country;
  return (
    <div className="mx-auto grid max-w-2xl gap-5 px-4 py-6 sm:px-6">
      <div className="grid gap-1">
        <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">Post a request</h1>
        <p className="text-navy-600">Can&apos;t find it? Tell sellers what you need, and those who have it answer in your messages.</p>
      </div>
      {!channels.wanted ? (
        <p className="rounded-2xl bg-navy-50 p-4 text-sm text-navy-700">Requests are not open in {market.name} yet.</p>
      ) : !own ? (
        <p className="rounded-2xl bg-navy-50 p-4 text-sm text-navy-700">You can post requests in your own country&apos;s market.</p>
      ) : (
        <div className="rounded-2xl border border-navy-200 bg-white p-4 sm:p-5">
          <WantedForm categories={reference.categories} states={reference.states} region={regionWord(market.country)} currency={market.currency} />
        </div>
      )}
    </div>
  );
}
