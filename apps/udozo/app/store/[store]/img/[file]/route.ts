import type { NextRequest } from "next/server";
import { storeHeader } from "@/lib/store-host";
import { servePhoto } from "@/lib/watermark";

/**
 * A listing photo on a reseller's store (its subdomain or own domain), with the store's mark where Udozo allows it and
 * it set one, else Udozo's. Reached only through the proxy, which names the store it found in `x-udozo-store` (a header
 * the browser sent under that name is always removed): anything else is not a store's request.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ store: string; file: string }> }) {
  const { store, file } = await params;
  if (request.headers.get(storeHeader) !== store) return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  return servePhoto(file, request.nextUrl.searchParams, store);
}
