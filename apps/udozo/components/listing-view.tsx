"use client";

import { useEffect } from "react";
import { maxEngagedSeconds } from "@/lib/discovery";
import { photosOpened, resetPhotos, track } from "@/lib/discovery-client";

/** How far down the page the reader has come, as a percentage (0 to 100). */
export function readDepth(scrollY: number, viewport: number, height: number) {
  if (height <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round(((scrollY + viewport) / height) * 100)));
}

/**
 * Counts the listing's page view once as it opens (the API counts a visitor once per listing in half an hour), and for
 * discovery records the view, then once, as the page is hidden, left or closed, how long it was read while visible
 * (at most ten minutes), how many photos were opened and how far down it was read (`engaged`).
 */
export function ListingView({ listingRef }: { listingRef: number }) {
  useEffect(() => {
    void fetch("/api/view", { method: "POST", keepalive: true, headers: { "content-type": "application/json" }, body: JSON.stringify({ ref: listingRef }) }).catch(() => undefined);
    resetPhotos();
    track({ kind: "view", listing: listingRef });

    let visibleMs = 0;
    let since = document.visibilityState === "visible" ? performance.now() : null;
    let depth = readDepth(window.scrollY, window.innerHeight, document.documentElement.scrollHeight);
    let sent = false;
    const send = () => {
      if (sent) return;
      sent = true;
      if (since !== null) visibleMs += performance.now() - since;
      since = null;
      const seconds = Math.min(maxEngagedSeconds, Math.round(visibleMs / 1000));
      if (seconds > 0) track({ kind: "engaged", listing: listingRef, seconds, photos: photosOpened(), depth }, { now: true });
    };
    const scrolled = () => {
      depth = Math.max(depth, readDepth(window.scrollY, window.innerHeight, document.documentElement.scrollHeight));
    };
    const visibility = () => {
      if (document.visibilityState === "hidden") send();
    };
    window.addEventListener("scroll", scrolled, { passive: true });
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", send);
    return () => {
      // Leaving for another page of the site (no pagehide then) ends the reading too.
      send();
      window.removeEventListener("scroll", scrolled);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", send);
    };
  }, [listingRef]);
  return null;
}
