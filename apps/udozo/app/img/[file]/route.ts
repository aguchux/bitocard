import type { NextRequest } from "next/server";
import { servePhoto } from "@/lib/watermark";

/**
 * A listing photo on udozo.com with Udozo's watermark drawn in (docs/UDOZO_WATERMARK_PLAN.md): `/img/<media id>.jpg?m=<mark
 * version>[&w=480|960|1600]`, cached for good under its address. A reseller's store serves the same path with its own
 * mark (`app/store/[store]/img/[file]`, through the proxy).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  return servePhoto(file, request.nextUrl.searchParams, null);
}
