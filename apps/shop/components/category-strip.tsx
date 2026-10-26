import Link from "next/link";
import { ShopIcon } from "@/components/icon";

type Category = { slug: string; name: string; icon: string | null };

/**
 * The categories as tiles: on phones one row swiped sideways (snapping, the next tile peeking, no scroll bar),
 * so the listings start higher up the page; a grid from tablets up. `contain-inline-size` keeps the row's tiles out of
 * its width, so a grid parent cannot grow to fit them and the page never scrolls sideways.
 */
export function CategoryStrip({ categories, href }: { categories: Category[]; href: (slug: string) => string }) {
  return (
    <div className="-mx-4 flex contain-inline-size snap-x snap-mandatory scroll-px-4 gap-2.5 overflow-x-auto overscroll-x-contain px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:grid sm:grid-cols-6 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-8 [&::-webkit-scrollbar]:hidden">
      {categories.map(category => (
        <Link key={category.slug} href={href(category.slug)} className="flex w-21 shrink-0 snap-start flex-col items-center gap-1.5 rounded-2xl border border-navy-200 bg-white px-1 py-2.5 text-center text-xs font-semibold hover:border-navy-400 sm:w-auto">
          <span className="grid size-10 place-items-center rounded-xl bg-brand-50 text-brand-700">
            <ShopIcon name={category.icon} className="size-5.5" />
          </span>
          <span className="line-clamp-2">{category.name}</span>
        </Link>
      ))}
    </div>
  );
}
