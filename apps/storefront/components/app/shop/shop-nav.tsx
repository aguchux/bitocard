import Link from "next/link";
import { Plus } from "lucide-react";
import { UnderlineTabs } from "@bitocard/ui/underline-tabs";
import { shopSections, type SubMenuContext } from "../sub-menus";

/**
 * The Shop tab's places as underlined tabs under the title on phones and tablets (the sub rail has them on desktop),
 * Messages with its unread count. `active` is the current item's address.
 */
export function ShopPills({ shop, active }: { shop: NonNullable<SubMenuContext["shop"]>; active: string | null }) {
  return (
    <UnderlineTabs
      label="Shop"
      className="lg:hidden"
      current={active}
      tabs={shopSections(shop)
        .filter(item => item.href !== "/shop/post")
        .map(({ href, label, badge, external }) => ({ href, label, badge, external }))}
    />
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
