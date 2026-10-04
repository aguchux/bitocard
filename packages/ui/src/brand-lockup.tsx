import Link from "next/link";
import { Brand } from "./brand";

/**
 * Header lockup: the "b" mark flush left spanning two lines, the name "Bitocard" with the tagline directly beneath.
 * Needs @bitocard/ui/styles/brand-lockup.css. Set --wordmark on .brand-lockup to scale it.
 */
export function BrandLockup({ tagline, href = "/" }: { tagline: string; href?: string }) {
  return (
    <Link className="wordmark brand-lockup" href={href}>
      <Brand />
      <span className="tagline">{tagline}</span>
    </Link>
  );
}
