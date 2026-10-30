import { NextResponse } from "next/server";
import { safeNext, siteOrigin } from "@/lib/customer";
import { currentStoreKey, storeOrigin } from "@/lib/store";

/**
 * Signing in on a store is signing in with the shopper's Udozo account: udozo.com's handoff (signing in there first if
 * needed) gives this store a one-time code for a session of its own, landing back on `next` here.
 */
export async function GET(request: Request) {
  const origin = await storeOrigin();
  const site = siteOrigin();
  if (!origin || !(await currentStoreKey())) return NextResponse.redirect(site, 303);
  const next = safeNext(new URL(request.url).searchParams.get("next"), "/");
  return NextResponse.redirect(`${site}/handoff/go?to=${encodeURIComponent(origin)}&next=${encodeURIComponent(next)}`, { status: 303, headers: { "cache-control": "no-store", "referrer-policy": "no-referrer" } });
}
