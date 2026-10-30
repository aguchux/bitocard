import { type NextRequest, NextResponse } from "next/server";
import { shopApi } from "@/lib/api";
import type { ShopSuggestions } from "@bitocard/api-client/classifieds";

const empty: ShopSuggestions = { object: "list", categories: [], queries: [] };

/** Suggestions as the buyer types (the search bar), from the API, cached a minute per country and words. */
export async function GET(request: NextRequest) {
  const country = request.nextUrl.searchParams.get("country") ?? "";
  const q = (request.nextUrl.searchParams.get("q") ?? "").trim().toLowerCase().slice(0, 60);
  if (!/^[a-z]{2}$/.test(country) || q.length < 2) return NextResponse.json(empty);
  const result = await shopApi<ShopSuggestions>(`/v1/classifieds/search/suggest?country=${country.toUpperCase()}&q=${encodeURIComponent(q)}`);
  return NextResponse.json(result.ok ? result.data : empty, { headers: { "cache-control": "public, max-age=60" } });
}
