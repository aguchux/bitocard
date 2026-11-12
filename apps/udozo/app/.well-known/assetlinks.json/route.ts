import type { NextRequest } from "next/server";
import { androidAssetLinks, appLinksResponse } from "@/lib/app-links";

/** Android's App Links for Udozo's app: proves the app may open udozo.com's links (lib/app-links.ts). */
export function GET(request: NextRequest) {
  return appLinksResponse(androidAssetLinks(), request.headers.get("host"));
}
