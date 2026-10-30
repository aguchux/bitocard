import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ResaleStoreSupplier } from "@bitocard/api-client/storefront";
import { ResaleSupplierPage } from "@/components/store/resale-detail";
import { uuidPattern } from "@/lib/shop";
import { requireStore, storeApi } from "@/lib/store";

type Props = { params: Promise<{ store: string; id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

async function load(key: string, id: string, raw: string | string[] | undefined) {
  if (!uuidPattern.test(id)) return null;
  const listing = Number.parseInt(Array.isArray(raw) ? (raw[0] ?? "") : (raw ?? ""), 10);
  const result = await storeApi<ResaleStoreSupplier>(key, `/v1/store/resale/suppliers/${id}`, { listing: Number.isFinite(listing) && listing > 0 ? listing : undefined });
  return result.ok ? result.data : null;
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { store, id } = await params;
  await requireStore(store);
  const supplier = await load(store, id, (await searchParams).listing);
  // Suppliers' pages are for checking a listing, not for search engines.
  return supplier ? { title: `Supplier: ${supplier.name}`, robots: { index: false, follow: true } } : {};
}

/** A supplier's page on a store: who supplies its items, and a listing exactly as they wrote it. */
export default async function StoreSupplierPage({ params, searchParams }: Props) {
  const { store, id } = await params;
  await requireStore(store);
  const supplier = await load(store, id, (await searchParams).listing);
  if (!supplier) notFound();
  return <ResaleSupplierPage supplier={supplier} />;
}
