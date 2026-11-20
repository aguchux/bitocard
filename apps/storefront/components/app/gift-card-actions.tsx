import Link from "next/link";
import { ChevronRight, type LucideIcon } from "lucide-react";
import type { StoreNavigationGroup } from "@bitocard/api-client/storefront";

/** The catalogue's gift card group. */
export const giftCardGroup = "gift-cards";

/** The catalogue's gift cards to choose one to sell: each card then opens on its Sell tab. */
export const sellCatalogHref = `/account/catalog?group=${giftCardGroup}&sell=1`;

/** How many gift cards are on sale in the group, from the menu's own counts. */
export function giftCardCount(group: StoreNavigationGroup | undefined) {
  return group?.categories.reduce((sum, category) => sum + (category.on_sale ? category.products : 0), 0) ?? 0;
}

export function ActionCard({ icon: Icon, tile, title, text, href }: { icon: LucideIcon; tile: string; title: string; text: string; href?: string }) {
  const body = (
    <>
      <span className={`grid size-12 place-items-center rounded-full text-white ${tile}`}>
        <Icon className="size-6" aria-hidden="true" strokeWidth={2} />
      </span>
      <span className="mt-5 flex items-center gap-2">
        <span className="text-lg font-bold text-navy-900">{title}</span>
        {href ? <ChevronRight className="ml-auto size-5 text-slate-400" aria-hidden="true" /> : null}
      </span>
      <span className="mt-1 block text-[15px] leading-relaxed text-slate-600">{text}</span>
    </>
  );
  const className = "flex h-full flex-col rounded-3xl bg-white p-5 ring-1 ring-slate-200/70 sm:p-6";
  return href ? (
    <Link href={href} className={`${className} transition hover:-translate-y-0.5 hover:shadow-md`}>
      {body}
    </Link>
  ) : (
    <div className={className} aria-disabled="true">
      {body}
    </div>
  );
}
