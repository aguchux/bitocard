import type { NextRequest } from "next/server";
import { androidAssetLinks, appLinksResponse } from "@/lib/app-links";

/** Android's App Links for BitoCard's app: proves the app may open bitocard.com's links (lib/app-links.ts). */
export function GET(request: NextRequest) {
  return appLinksResponse(androidAssetLinks(), request.headers.get("host"));
}
