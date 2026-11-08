import Link from "next/link";
import { safeBannerHref, type SiteBanner } from "@/lib/banners";

/**
 * A banner ad placed by Udozo's team in its admin: above the account menu (the rail's full width) and in the account
 * dashboard's places, the full width of where it is put. Labelled Ad, in words that are part of the link's name;
 * another site opens in a new tab, marked sponsored for search engines.
 */
export function RailBanner({ banner, className = "" }: { banner: SiteBanner; className?: string }) {
  const link = safeBannerHref(banner.href);
  if (!link) return null;
  const body = (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element -- banners uploaded by Udozo's team, on its own storage */}
      <img src={banner.image_url} alt={banner.alt} className="block h-auto min-h-10 w-full object-cover" />
      <span className="absolute top-1.5 right-1.5 rounded bg-navy-900/75 px-1.5 py-0.5 text-[10px] leading-none font-bold tracking-wide text-white uppercase">Ad</span>
    </>
  );
  const linkClass = "relative block min-h-10 w-full overflow-hidden rounded-xl border border-navy-100 bg-white hover:border-navy-300 focus-visible:outline-2 focus-visible:outline-brand-500";
  return (
    <aside aria-label="Advertisement" data-banner={banner.id} className={className || undefined}>
      {link.external ? (
        <a href={link.href} target="_blank" rel="sponsored noopener" className={linkClass}>
          {body}
        </a>
      ) : (
        <Link href={link.href} className={linkClass}>
          {body}
        </Link>
      )}
    </aside>
  );
}
