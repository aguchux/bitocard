"use client";

import { useEffect, useRef } from "react";
import { countSellVisit } from "@/lib/posting-actions";
import type { SellSource } from "@/lib/sell-sources";

/** Counts Post an ad (or sign-in on the way to it) once per opening, by where Sell was pressed: the top of the posting funnel. */
export function SellVisit({ source, signedIn }: { source: SellSource; signedIn: boolean }) {
  const counted = useRef(false);
  useEffect(() => {
    if (counted.current) return;
    counted.current = true;
    void countSellVisit(source, signedIn).catch(() => undefined);
  }, [source, signedIn]);
  return null;
}
