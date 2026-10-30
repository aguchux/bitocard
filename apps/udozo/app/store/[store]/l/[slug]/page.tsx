import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import type { ResaleStoreListingDetail } from "@bitocard/api-client/storefront";
import { ResaleBuy } from "@/components/store/resale-buy";
import { ResaleListingDetail } from "@/components/store/resale-detail";
import { currentCustomer, siteOrigin } from "@/lib/customer";
import { listingRef, resaleListingPath } from "@/lib/resale-links";
import { requireStore, storeApi } from "@/lib/store";

type Props = { params: Promise<{ store: string; slug: string }> };

async function load(key: string, slug: string) {
  const ref = listingRef(slug);
  if (ref === null) return null;
  const result = await storeApi<ResaleStoreListingDetail>(key, `/v1/store/resale/listings/${ref}`);
  return result.ok ? result.data : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { store, slug } = await params;
  await requireStore(store);
  const item = await load(store, slug);
  if (!item) return {};
  return {
    title: item.title,
    description: `${item.title}, supplied by ${item.supplier.name}. Your payment is held until you have it.`,
    alternates: { canonical: resaleListingPath(item) },
    openGraph: item.photos[0] ? { images: [{ url: item.photos[0].url }] } : undefined,
  };
}

/** A store's listing (`/l/<ref>-<slug>`): an old or missing slug goes to its current address for good. */
export default async function StoreListingPage({ params }: Props) {
  const { store: key, slug } = await params;
  const store = await requireStore(key);
  const [item, customer] = await Promise.all([load(key, slug), currentCustomer()]);
  if (!item) notFound();
  if (slug !== `${item.ref}-${item.slug}`) permanentRedirect(resaleListingPath(item));
  return (
    <div className="grid gap-4">
      <Link href="/listings" className="inline-flex w-fit items-center gap-1 text-sm font-semibold text-slate-600 hover:text-navy-900">
        <ChevronLeft className="size-4" aria-hidden="true" /> All items
      </Link>
      <ResaleListingDetail
        item={item}
        storeName={store.name}
        buy={<ResaleBuy item={item} signedIn={Boolean(customer)} signInHref={`/signin?next=${encodeURIComponent(resaleListingPath(item))}`} stateName={item.area?.state ?? null} accountOrigin={siteOrigin()} />}
      />
    </div>
  );
}
