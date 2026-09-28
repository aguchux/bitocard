"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { legalDocuments } from "@bitocard/ui/legal";

/** Switch between legal documents while reading one. */
export function DocTabs() {
  const pathname = usePathname();
  return (
    <nav className="doc-tabs" aria-label="Legal documents">
      {legalDocuments.map(doc => (
        <Link key={doc.href} href={doc.href} aria-current={pathname === doc.href ? "page" : undefined}>{doc.label}</Link>
      ))}
    </nav>
  );
}
