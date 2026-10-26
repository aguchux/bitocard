import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { ResaleBuy } from "@/components/store/resale-buy";
import { ResaleListingDetail } from "@/components/store/resale-detail";
import { currentCustomer } from "@/lib/customer";
import { resaleListing, resaleStore } from "@/lib/resale";
import { listingRef, resaleListingPath } from "@/lib/resale-links";

type Props = { params: Promise<{ slug: string }> };

async function load(slug: string) {
  const ref = listingRef(slug);
  if (ref === null || !(await resaleStore())) return null;
  const result = await resaleListing(ref);
  return result.ok ? result.data : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const item = await load((await params).slug);
  if (!item) return {};
  return {
    title: item.title,
    description: `${item.title}, supplied by ${item.supplier.name}. Your payment is held until you have it.`,
    alternates: { canonical: resaleListingPath(item) },
    openGraph: item.photos[0] ? { images: [{ url: item.photos[0].url }] } : undefined,
  };
}

/** A Resale shop's listing (`/l/<ref>-<slug>`): an old or missing slug goes to its current address for good. */
export default async function ResaleListingPage({ params }: Props) {
  const { slug } = await params;
  const [item, store, customer] = await Promise.all([load(slug), resaleStore(), currentCustomer()]);
  if (!item || !store) notFound();
  if (slug !== `${item.ref}-${item.slug}`) permanentRedirect(resaleListingPath(item));
  return (
    <div className="grid gap-4">
      <Link href="/listings" className="inline-flex w-fit items-center gap-1 text-sm font-semibold text-slate-600 hover:text-navy-900">
        <ChevronLeft className="size-4" aria-hidden="true" /> All items
      </Link>
      <ResaleListingDetail
        item={item}
        storeName={store.name}
        buy={<ResaleBuy item={item} signedIn={Boolean(customer)} signInHref={`/signin?next=${encodeURIComponent(resaleListingPath(item))}`} stateName={item.area?.state ?? null} />}
      />
    </div>
  );
}