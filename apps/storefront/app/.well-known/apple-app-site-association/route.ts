import type { NextRequest } from "next/server";
import { appLinksResponse, appleAssociation } from "@/lib/app-links";

/** Apple's universal links for BitoCard's app: proves the app may open bitocard.com's links (lib/app-links.ts). */
export function GET(request: NextRequest) {
  return appLinksResponse(appleAssociation(), request.headers.get("host"));
}
