import type { NextRequest } from "next/server";
import { failureCacheControl, serveSellerCard } from "@/lib/seller-card";
import { siteOrigin } from "@/lib/site";
import { classifyHost } from "@/lib/store-host";

/**
 * A seller page's share images on udozo.com: `/seller-card/<handle>.jpg` (the still card, 1200 × 630) and
 * `/seller-card/<handle>.gif` (the card, then a few of their listings at random, within 300 KB). Seller pages are
 * udozo.com's only: on a reseller's store the proxy sends this path to the store's own folder, where nothing answers,
 * and a store's host reaching this route is refused here too.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ file: string }> }) {
  if (classifyHost(request.headers.get("host") ?? request.nextUrl.host, siteOrigin()).kind !== "marketplace") return new Response(null, { status: 404, headers: { "Cache-Control": failureCacheControl } });
  return serveSellerCard((await params).file);
}
