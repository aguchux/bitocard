import type { NextRequest } from "next/server";
import { appLinksResponse, appleAssociation } from "@/lib/app-links";

/** Apple's universal links for Udozo's app: which udozo.com pages it opens (lib/app-links.ts). */
export function GET(request: NextRequest) {
  return appLinksResponse(appleAssociation(), request.headers.get("host"));
}
