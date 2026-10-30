"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useClaimStoreGuideMutation } from "@bitocard/api-client/reseller";
import { StoreGuideDialog } from "@bitocard/admin-ui";
import { can, useReseller } from "@/components/reseller";

/**
 * Opens the guide to creating a first store when the API says one is due: for owners and admins whose account has no
 * store, while BitoCard's `shq_store_guide` switch is on, at most three times each, at least 10 minutes apart (the API
 * counts every showing). It asks when SHQ opens and again on a later page once `next_at` has passed, never on the
 * Store pages, where the person is already at it.
 */
export function ShqStoreGuide() {
  const { membership } = useReseller();
  const router = useRouter();
  const pathname = usePathname();
  const [claim] = useClaimStoreGuideMutation();
  const [open, setOpen] = useState(false);
  const [last, setLast] = useState(false);
  // When this account may ask next (Infinity once it never will), and whether a request is on its way.
  const next = useRef<{ account: string; at: number } | null>(null);
  const asking = useRef(false);
  const account = membership.reseller.id;
  const creates = can(membership, "admin");

  useEffect(() => {
    if (!creates || open || asking.current || pathname === "/store" || pathname.startsWith("/store/")) return;
    if (next.current?.account === account && Date.now() < next.current.at) return;
    asking.current = true;
    claim()
      .unwrap()
      .then(guide => {
        next.current = { account, at: guide.next_at ? Date.parse(guide.next_at) : Infinity };
        if (guide.show) {
          setLast(guide.times_shown >= guide.limit);
          setOpen(true);
        }
      })
      // Not shown this time; it asks again on a page 10 minutes on.
      .catch(() => {
        next.current = { account, at: Date.now() + 10 * 60_000 };
      })
      .finally(() => {
        asking.current = false;
      });
  }, [account, claim, creates, open, pathname]);

  if (!open) return null;
  return (
    <StoreGuideDialog
      open
      last={last}
      onClose={() => setOpen(false)}
      onStart={() => {
        setOpen(false);
        router.push("/store/new");
      }}
    />
  );
}
