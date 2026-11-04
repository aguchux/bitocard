"use client";

import { useEffect } from "react";
import { track } from "@/lib/discovery-client";

/**
 * Records a results page once as it shows: a `search` when words were typed, a `filter` when the results were narrowed
 * without words (a plain category or place page records nothing). Results pages are cached, so the search is told from
 * the page, never from the API's own search.
 */
export function SearchEvent({ query, filters, results, sort }: { query: string; filters: Record<string, string | string[]>; results: number; sort: string | null }) {
  const narrowed = Object.keys(filters).some(key => !["category", "state", "area"].includes(key));
  const key = JSON.stringify([query, filters, results, sort]);
  useEffect(() => {
    if (query) track({ kind: "search", query, filters, results, ...(sort ? { sort } : {}) });
    else if (narrowed) track({ kind: "filter", filters, results, ...(sort ? { sort } : {}) });
    // One event per distinct page of results.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return null;
}
