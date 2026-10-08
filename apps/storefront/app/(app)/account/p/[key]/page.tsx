import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadProduct, ProductDetail, productMetadata } from "@/components/store/product-detail";

export async function generateMetadata({ params }: { params: Promise<{ key: string }> }): Promise<Metadata> {
  return { ...(await productMetadata(decodeURIComponent((await params).key), "/p")), robots: { index: false, follow: false } };
}

/** A product inside the account app: the same page as the store's, staying in the app. */
export default async function AppProductPage({ params }: { params: Promise<{ key: string }> }) {
  const result = await loadProduct(decodeURIComponent((await params).key));
  if (!result.ok) notFound();
  return <ProductDetail product={result.data} inApp />;
}
