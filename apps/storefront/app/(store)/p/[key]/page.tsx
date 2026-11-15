import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadProduct, ProductDetail, productMetadata } from "@/components/store/product-detail";

export const revalidate = 60;

export async function generateMetadata({ params }: { params: Promise<{ key: string }> }): Promise<Metadata> {
  return productMetadata(decodeURIComponent((await params).key), "/p");
}

export default async function ProductPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<{ sell?: string }> }) {
  const result = await loadProduct(decodeURIComponent((await params).key));
  if (!result.ok) notFound();
  return <ProductDetail product={result.data} sell={(await searchParams).sell === "1"} />;
}
