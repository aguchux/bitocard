import { type NextRequest, NextResponse } from "next/server";
import { customerFetch } from "@/lib/customer";

/**
 * A listing's page was opened (`ListingView`): told to the API with the visitor's signed address, their browser and,
 * signed in, their session (a seller's own views are not counted). Only from this site's own pages; never cached.
 */
export async function POST(request: NextRequest) {
  const done = new NextResponse(null, { status: 204, headers: { "cache-control": "no-store" } });
  if (request.headers.get("sec-fetch-site") !== "same-origin") return done;
  const body = (await request.json().catch(() => null)) as { ref?: unknown } | null;
  const ref = typeof body?.ref === "number" && Number.isSafeInteger(body.ref) && body.ref > 0 ? body.ref : null;
  if (ref) await customerFetch("POST", `/v1/classifieds/listings/${ref}/view`, undefined, { headers: { "user-agent": request.headers.get("user-agent") ?? "" } });
  return done;
}
