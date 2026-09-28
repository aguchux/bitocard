"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { legalDocuments } from "@bitocard/ui/legal";

const links = [{ href: "/legal", label: "Overview" }, ...legalDocuments];

export function LegalNav() {
  const pathname = usePathname();
  return (
    <nav className="legal-nav" aria-label="Legal documents">
      {links.map(link => (
        <Link key={link.href} href={link.href} aria-current={pathname === link.href ? "page" : undefined}>{link.label}</Link>
      ))}
    </nav>
  );
}
