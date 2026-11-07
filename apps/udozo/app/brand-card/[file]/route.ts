import type { NextRequest } from "next/server";
import { serveBrandCard } from "@/lib/brand-card";
import { failureCacheControl } from "@/lib/seller-card";
import { siteOrigin } from "@/lib/site";
import { classifyHost } from "@/lib/store-host";

/**
 * A brand page's share images on udozo.com: `/brand-card/<cc>-<slug>.jpg` (the still card, 1200 × 630, its listings'
 * photos picked at random) and `/brand-card/<cc>-<slug>.gif` (the card, then a few of its listings at random, within
 * 300 KB). Brand pages are udozo.com's only: on a reseller's store the proxy sends this path to the store's own folder,
 * where nothing answers, and a store's host reaching this route is refused here too.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ file: string }> }) {
  if (classifyHost(request.headers.get("host") ?? request.nextUrl.host, siteOrigin()).kind !== "marketplace") return new Response(null, { status: 404, headers: { "Cache-Control": failureCacheControl } });
  return serveBrandCard((await params).file);
}
