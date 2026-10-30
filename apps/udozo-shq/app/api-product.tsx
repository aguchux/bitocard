"use client";

import { setApiProduct } from "@bitocard/api-client";

// Udozo's apps call Udozo's own API instance (api.udozo.com in production; NEXT_PUBLIC_API_URL in development), with
// BitoCard's own paths: the same code runs there (docs/UDOZO_SPINOFF_PLAN.md). Set once, before any request.
setApiProduct("udozo");

export function UdozoApiProduct({ children }: { children: React.ReactNode }) {
  return children;
}
