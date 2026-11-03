"use client";

import { useEffect, useRef } from "react";
import { countSignupVisit } from "@/lib/account-actions";

/** Counts the sign-up page once per opening (never on prefetches or by robots without script): the top of the funnel. */
export function SignupVisit() {
  const counted = useRef(false);
  useEffect(() => {
    if (counted.current) return;
    counted.current = true;
    void countSignupVisit().catch(() => undefined);
  }, []);
  return null;
}
