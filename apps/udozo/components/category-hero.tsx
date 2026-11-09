import Link from "next/link";
import { categoryPath, type ShopCategory } from "@bitocard/api-client/classifieds";
import { ShopIcon } from "@/components/icon";

type Pictures = { banner_url?: string | null; spotlight_url?: string | null };

/**
 * A category page's header: the top category's banner (an admin's upload, 4:1, else Udozo's drawn one) with the name
 * written over its left side, washed whitish, and on the right the top category's spotlight image (a cut-out of what is sold
 * there) sitting straight on the banner, with no backing. A subcategory shows its top category's banner and its own icon
 * on a faint circle, as does a top category without a spotlight image. The pictures are decoration: the name and figures are the page's words.
 */
export function CategoryHero({
  category,
  top,
  place,
  listings,
  eyebrow,
}: {
  category: Pick<ShopCategory, "slug" | "name" | "icon">;
  top: Pictures & Pick<ShopCategory, "name" | "slug">;
  place: string;
  listings: number | null;
  /** Above the name: the top category's name on a subcategory's page. */
  eyebrow?: string | null;
}) {
  const banner = top.banner_url || null;
  // Only a top category's own page shows its spotlight image; a subcategory's shows its own icon.
  const spotlight = category.slug === top.slug ? top.spotlight_url || null : null;
  return (
    <section aria-labelledby="category-name" className="relative isolate overflow-hidden rounded-3xl bg-gradient-to-br from-navy-900 via-navy-700 to-brand-600 text-navy-900">
      {banner ? (
        // eslint-disable-next-line @next/next/no-img-element -- an admin's checked upload on the media CDN.
        <img src={banner} alt="" className="absolute inset-0 -z-10 size-full object-cover" />
      ) : (
        <span aria-hidden="true" className="absolute inset-0 -z-10">
          <span className="absolute -top-20 right-1/4 size-64 rounded-full bg-white/10" />
          <span className="absolute -bottom-24 left-1/3 size-56 rounded-full bg-brand-400/20" />
          <span className="absolute top-8 left-6 size-16 rounded-full border border-white/15" />
        </span>
      )}
      {/* Whitish on the left, where the name is written, so the words and the spotlight image never compete with the banner. */}
      <span aria-hidden="true" className="absolute inset-0 -z-10 bg-gradient-to-r from-white/95 via-white/75 to-white/15" />
      <div className="flex min-h-40 items-center justify-between gap-4 px-5 py-6 sm:min-h-52 sm:px-8 lg:min-h-64 lg:px-12">
        <div className="grid min-w-0 gap-1.5 sm:gap-2">
          {eyebrow ? <p className="text-xs font-semibold tracking-wide text-brand-600 uppercase sm:text-sm">{eyebrow}</p> : null}
          <h1 id="category-name" className="text-2xl font-extrabold tracking-tight text-balance sm:text-4xl lg:text-5xl">
            {category.name}
          </h1>
          <p className="text-sm text-navy-700 sm:text-base">
            {listings === null ? `For sale in ${place}` : `${listings.toLocaleString("en-GB")} ${listings === 1 ? "listing" : "listings"} in ${place}`}
          </p>
        </div>
        {spotlight ? (
          // Straight on the banner, no backing: a cut-out on a clear background.
          // eslint-disable-next-line @next/next/no-img-element -- an admin's checked upload on the media CDN.
          <img src={spotlight} alt="" aria-hidden="true" className="size-32 shrink-0 object-contain drop-shadow-2xl sm:size-52 lg:size-64" />
        ) : (
          <span aria-hidden="true" className="grid size-24 shrink-0 place-items-center rounded-full bg-white/10 ring-1 ring-white/20 sm:size-36 lg:size-44">
            <ShopIcon name={category.icon} className="size-12 text-white sm:size-16 lg:size-20" />
          </span>
        )}
      </div>
    </section>
  );
}

/**
 * A top category's subcategories as pills with their icons, sliding sideways on phones; on a subcategory's page, its
 * sisters, with the one shown marked.
 */
export function SubcategoryPills({ country, items, current }: { country: string; items: Array<Pick<ShopCategory, "slug" | "name" | "icon">>; current?: string }) {
  if (!items.length) return null;
  return (
    <nav aria-label="Subcategories" className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none]">
      <ul className="flex gap-2 whitespace-nowrap">
        {items.map(child => (
          <li key={child.slug}>
            <Link
              href={categoryPath(country, child.slug)}
              aria-current={child.slug === current ? "page" : undefined}
              className={`flex h-11 items-center gap-2 rounded-full border pr-4 pl-1.5 text-sm font-semibold ${child.slug === current ? "border-navy-900 bg-navy-900 text-white" : "border-navy-200 bg-white hover:border-navy-400"}`}
            >
              <span className={`grid size-8 place-items-center rounded-full ${child.slug === current ? "bg-white/15 text-white" : "bg-navy-50 text-brand-600"}`}>
                <ShopIcon name={child.icon} className="size-4" />
              </span>
              {child.name}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
