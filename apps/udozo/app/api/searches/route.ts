import { type NextRequest, NextResponse } from "next/server";
import { shopApi } from "@/lib/api";
import type { SearchSuggestions } from "@/lib/discovery";
import { currentVisitor, discoveryFetch, signedIn } from "@/lib/discovery-server";

const noStore = { "cache-control": "private, no-store" };
const queries = (data: unknown) =>
  data && typeof data === "object" && Array.isArray((data as { data?: unknown }).data)
    ? ((data as { data: Array<{ query?: unknown }> }).data.map(item => item.query).filter((query): query is string => typeof query === "string" && query.length > 0).slice(0, 8))
    : [];

/**
 * What the search box offers before anything is typed: the person's recent searches (signed in, or a visitor who chose
 * Accept all) and the market's popular ones. Only from this site's own pages; never cached (the popular list is, by the
 * API's read, for ten minutes).
 */
export async function GET(request: NextRequest) {
  const country = (request.nextUrl.searchParams.get("country") ?? "").toUpperCase();
  if (request.headers.get("sec-fetch-site") !== "same-origin" || !/^[A-Z]{2}$/.test(country)) return NextResponse.json({ recent: [], popular: [] } satisfies SearchSuggestions, { headers: noStore });
  const person = (await signedIn()) || Boolean(await currentVisitor());
  const [recent, popular] = await Promise.all([
    person ? discoveryFetch("GET", `/v1/classifieds/search/recent?country=${country}`).then(res => (res?.ok ? res.json().catch(() => null) : null)) : null,
    shopApi<unknown>(`/v1/classifieds/search/popular?country=${country}`, { revalidate: 600 }),
  ]);
  return NextResponse.json({ recent: queries(recent), popular: popular.ok ? queries(popular.data) : [] } satisfies SearchSuggestions, { headers: noStore });
}

/** Removes one of the person's recent searches. */
export async function DELETE(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 100);
  if (request.headers.get("sec-fetch-site") !== "same-origin" || !q) return new NextResponse(null, { status: 204, headers: noStore });
  await discoveryFetch("DELETE", `/v1/classifieds/history/searches?q=${encodeURIComponent(q)}`);
  return new NextResponse(null, { status: 204, headers: noStore });
}
