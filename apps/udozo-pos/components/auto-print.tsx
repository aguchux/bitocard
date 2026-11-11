"use client";

import { useEffect } from "react";

/** Opens the browser's print dialog once the receipt is drawn (the till's "Print each receipt"), and a button to print again. */
export function AutoPrint({ auto }: { auto: boolean }) {
  useEffect(() => {
    if (!auto) return;
    const timer = window.setTimeout(() => window.print(), 300);
    return () => window.clearTimeout(timer);
  }, [auto]);
  return (
    <button type="button" onClick={() => window.print()} className="no-print flex h-12 items-center rounded-xl bg-pos-600 px-6 font-bold text-white hover:bg-pos-700">
      Print
    </button>
  );
}
