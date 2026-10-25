import Link from "next/link";
import { Plus } from "lucide-react";
import { shopSections, type SubMenuContext } from "../sub-menus";

/**
 * The Shop tab's places as pills under the title on phones and tablets (the sub rail has them on desktop), Messages
 * with its unread count. `active` is the current item's address.
 */
export function ShopPills({ shop, active }: { shop: NonNullable<SubMenuContext["shop"]>; active: string | null }) {
  return (
    <nav aria-label="Shop" className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:-mx-6 sm:px-6 lg:hidden">
      <ul className="flex gap-2 whitespace-nowrap">
        {shopSections(shop)
          .filter(item => item.href !== "/shop/post")
          .map(item => {
            const current = item.href === active;
            const className = `flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-semibold ${current ? "border-navy-900 bg-navy-900 text-white" : "border-slate-300 bg-white text-navy-900 hover:border-slate-400"}`;
            const inner = (
              <>
                {item.label}
                {item.badge ? (
                  <span className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-brand-700 px-1 text-[11px] text-white">
                    {item.badge > 99 ? "99+" : item.badge}
                    <span className="sr-only"> unread</span>
                  </span>
                ) : null}
              </>
            );
            return (
              <li key={item.href}>
                {item.external ? (
                  <a href={item.href} className={className}>
                    {inner}
                  </a>
                ) : (
                  <Link href={item.href} aria-current={current ? "page" : undefined} className={className}>
                    {inner}
                  </Link>
                )}
              </li>
            );
          })}
      </ul>
    </nav>
  );
}

/** A Shop page's title, with Post an ad beside it. */
export function ShopTitle({ title, note, post = true }: { title: string; note?: string; post?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">{title}</h1>
        {note ? <p className="mt-1 text-sm text-slate-600">{note}</p> : null}
      </div>
      {post ? (
        <Link href="/shop/post" className="flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-brand-700 px-4 text-sm font-bold text-white hover:bg-brand-600">
          <Plus className="size-4" strokeWidth={2.6} aria-hidden="true" />
          Post an ad
        </Link>
      ) : null}
    </div>
  );
}
