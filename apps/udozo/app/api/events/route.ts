import { type NextRequest, NextResponse } from "next/server";
import { cleanBatch } from "@/lib/discovery";
import { currentVisitor, discoveryFetch, signedIn } from "@/lib/discovery-server";

/**
 * A batch of what a visit looked at (`lib/discovery-client.ts`), passed to Udozo's API with the customer's session or
 * the visitor's ID, the signed address and the browser. Nothing is passed on for someone who is neither signed in nor a
 * visitor who chose Accept all. Only from this site's own pages; sent as plain text (a beacon), read as JSON.
 */
export async function POST(request: NextRequest) {
  const done = new NextResponse(null, { status: 204, headers: { "cache-control": "no-store" } });
  if (request.headers.get("sec-fetch-site") !== "same-origin") return done;
  if (!(await signedIn()) && !(await currentVisitor())) return done;
  const text = await request.text().catch(() => "");
  if (text.length > 64_000) return done;
  let raw: unknown = null;
  try {
    raw = JSON.parse(text);
  } catch {
    return done;
  }
  const batch = cleanBatch(raw);
  if (batch) await discoveryFetch("POST", "/v1/classifieds/events", batch);
  return done;
}
