"use client";

import { useEffect } from "react";

/** Counts the listing's page view once as it opens (the API counts a visitor once per listing in half an hour). */
export function ListingView({ listingRef }: { listingRef: number }) {
  useEffect(() => {
    void fetch("/api/view", { method: "POST", keepalive: true, headers: { "content-type": "application/json" }, body: JSON.stringify({ ref: listingRef }) }).catch(() => undefined);
  }, [listingRef]);
  return null;
}
