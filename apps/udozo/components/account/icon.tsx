"use client";

import { DynamicIcon, iconNames, type IconName } from "lucide-react/dynamic";

const known = new Set<string>(iconNames);

/** A category's or feature's icon by its lucide name (from Udozo's registry), or a plain tag when unknown. */
export function ShopIcon({ name, className = "size-5" }: { name: string | null | undefined; className?: string }) {
  return <DynamicIcon name={(name && known.has(name) ? name : "tag") as IconName} className={className} aria-hidden="true" />;
}
