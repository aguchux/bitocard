import { type NextRequest, NextResponse } from "next/server";
import type { ForYou, ForYouKind } from "@bitocard/api-client/discovery";
import { forYouKinds } from "@/lib/discovery";
import { discoveryFetch } from "@/lib/discovery-server";

const empty: ForYou = { object: "for_you", personalised: false, rows: [] };
const noStore = { "cache-control": "private, no-store" };

/**
 * A home page's personal rows (For you, Recently viewed, Because you searched, Price dropped), chosen for whoever is
 * looking: their session or visitor ID goes with the request; without either, For you is the popular order. Never
 * cached; only from this site's own pages; empty while the API cannot answer.
 */
export async function GET(request: NextRequest) {
  if (request.headers.get("sec-fetch-site") !== "same-origin") return NextResponse.json(empty, { status: 403, headers: noStore });
  const params = request.nextUrl.searchParams;
  const country = (params.get("country") ?? "").toUpperCase();
  const kinds = (params.get("kinds") ?? "for_you").split(",").filter((kind): kind is ForYouKind => (forYouKinds as string[]).includes(kind));
  const limit = Math.min(24, Math.max(1, Number(params.get("limit")) || 12));
  if (!/^[A-Z]{2}$/.test(country) || !kinds.length) return NextResponse.json(empty, { headers: noStore });
  const res = await discoveryFetch("GET", `/v1/classifieds/for-you?country=${country}&kinds=${[...new Set(kinds)].join(",")}&limit=${limit}`);
  const data = res?.ok ? ((await res.json().catch(() => null)) as ForYou | null) : null;
  return NextResponse.json(data?.object === "for_you" && Array.isArray(data.rows) ? data : empty, { headers: noStore });
}
