import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ResaleSupplierPage } from "@/components/store/resale-detail";
import { resaleStore, resaleSupplier } from "@/lib/resale";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function load(id: string, raw: string | string[] | undefined) {
  if (!uuid.test(id) || !(await resaleStore())) return null;
  const listing = Number.parseInt(Array.isArray(raw) ? (raw[0] ?? "") : (raw ?? ""), 10);
  const result = await resaleSupplier(id, Number.isFinite(listing) && listing > 0 ? listing : undefined);
  return result.ok ? result.data : null;
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const supplier = await load((await params).id, (await searchParams).listing);
  // Suppliers' pages are for checking a listing, not for search engines.
  return supplier ? { title: `Supplier: ${supplier.name}`, robots: { index: false, follow: true } } : {};
}

/** A supplier's page on a Resale shop (B2B reselling): who supplies the store's items, and a listing as they wrote it. */
export default async function SupplierPage({ params, searchParams }: Props) {
  const supplier = await load((await params).id, (await searchParams).listing);
  if (!supplier) notFound();
  return <ResaleSupplierPage supplier={supplier} />;
}