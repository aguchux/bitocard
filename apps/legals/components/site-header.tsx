"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BrandLockup } from "@bitocard/ui/brand-lockup";
import { sections } from "@/components/content";

export function SiteHeader() {
  const pathname = usePathname();
  return (
    <header className="site-header">
      <BrandLockup tagline="Legals & Compliance" />
      <nav aria-label="Main">
        {sections.map(section => (
          <Link key={section.href} href={section.href} aria-current={section.match(pathname) ? "page" : undefined}>{section.label}</Link>
        ))}
      </nav>
    </header>
  );
}
