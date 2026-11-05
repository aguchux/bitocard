"use client";

import { useState } from "react";
import { Check, Share2 } from "lucide-react";

/** Shares a seller's page: the device's share sheet, else the link copied (else WhatsApp). */
export function SellerShare({ url, name }: { url: string; name: string }) {
  const [copied, setCopied] = useState(false);
  const share = async () => {
    const title = `${name} on Udozo`;
    if (navigator.share) {
      await navigator.share({ title, url }).catch(() => undefined);
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      window.open(`https://wa.me/?text=${encodeURIComponent(`${title}: ${url}`)}`, "_blank", "noopener");
    }
  };
  return (
    <button type="button" onClick={() => void share()} className="inline-flex h-10 items-center gap-2 rounded-full border border-navy-200 bg-white px-4 text-sm font-semibold text-navy-900 hover:border-navy-400">
      {copied ? <Check className="size-4 text-mint-700" aria-hidden="true" /> : <Share2 className="size-4" aria-hidden="true" />}
      {copied ? "Link copied" : "Share"}
    </button>
  );
}
