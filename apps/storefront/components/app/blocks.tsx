import Link from "next/link";
import { ChevronRight, Gift, type LucideIcon } from "lucide-react";
import type { StoreNavigationGroup, StoreProduct } from "@bitocard/api-client/storefront";
import { GroupIcon } from "@/components/store/category-icon";
import { groupIcon } from "@/components/store/theme";
import { BrandImage } from "@/components/store/brand-image";
import { priceLabel, productHref } from "@/components/store/product-card";
import { groupTint } from "./theme";

/** Where the account app's product pages live. */
export const appProductBase = "/account/p";

/** A tinted figure card at the top of Home (as in the mockups): icon tile, label, large figure. */
export function StatCard({ icon: Icon, label, value, note, tone }: { icon: LucideIcon; label: string; value: string; note?: string; tone: "pink" | "blue" | "green" | "navy" }) {
  const colours = {
    pink: { card: "bg-pink-50", tile: "bg-pink-100 text-[#ff2382]" },
    blue: { card: "bg-blue-50", tile: "bg-blue-100 text-[#2477ff]" },
    green: { card: "bg-emerald-50", tile: "bg-emerald-100 text-emerald-600" },
    navy: { card: "bg-indigo-50", tile: "bg-indigo-100 text-[#070f4c]" },
  }[tone];
  return (
    // As in the mockups: the icon tile beside the label and figure at every width.
    <div className={`flex h-full min-h-[88px] items-center gap-3.5 rounded-3xl p-4 sm:gap-4 sm:p-5 md:gap-3 md:p-4 lg:gap-4 lg:p-5 ${colours.card}`}>
      <span className={`grid size-14 shrink-0 place-items-center rounded-2xl md:size-12 lg:size-16 ${colours.tile}`}>
        <Icon className="size-7 md:size-6 lg:size-8" aria-hidden="true" strokeWidth={2.25} />
      </span>
      <div className="min-w-0">
        <p className="text-[15px] font-semibold text-[#070f4c] md:text-sm lg:text-base">{label}</p>
        <p className="text-[28px] leading-tight font-extrabold tracking-tight break-words text-[#070f4c] md:text-[22px] lg:text-[26px] xl:text-[32px]">{value}</p>
        {note ? <p className="text-xs text-slate-500">{note}</p> : null}
      </div>
    </div>
  );
}

/**
 * A menu group's solid icon (as in the mockups): filled in the group's colour with white detail; line-only icons
 * (the signal bars) are drawn thick instead.
 */
function SolidGroupIcon({ group, tint }: { group: StoreNavigationGroup; tint: ReturnType<typeof groupTint> }) {
  const Icon = groupIcon[group.key] ?? Gift;
  const lineOnly = group.key === "esims";
  return (
    <span className={`grid size-14 shrink-0 place-items-center rounded-2xl md:size-12 lg:size-16 ${tint.tile} ${tint.ink}`}>
      {lineOnly ? (
        <Icon className="size-9 md:size-8 lg:size-10" strokeWidth={3} aria-hidden="true" />
      ) : (
        <Icon className="size-9 md:size-8 lg:size-10" fill="currentColor" stroke="white" strokeWidth={1.75} aria-hidden="true" />
      )}
    </span>
  );
}

/** A menu group as a tinted entry card: icon tile, name, subtitle and chevron. Groups not open yet say "Coming soon". */
export function CategoryEntry({ group }: { group: StoreNavigationGroup }) {
  const tint = groupTint(group.key);
  const uploaded = group.categories.some(category => category.icon_url);
  const body = (
    <>
      {uploaded ? <GroupIcon group={group} className="size-14 rounded-2xl md:size-12 lg:size-16" ink={tint.ink} tile={tint.tile} /> : <SolidGroupIcon group={group} tint={tint} />}
      <span className="min-w-0 flex-1">
        <span className="block text-xl leading-tight font-bold text-[#070f4c] md:text-lg lg:text-xl">{group.label}</span>
        <span className="mt-0.5 block truncate text-sm text-slate-500 lg:text-[15px]">{group.on_sale ? tint.subtitle : "Coming soon"}</span>
      </span>
      {group.on_sale ? (
        <span aria-hidden="true" className={`grid size-9 shrink-0 place-items-center rounded-full md:size-8 lg:size-10 ${tint.chevron}`}>
          <ChevronRight className="size-5" strokeWidth={2.5} />
        </span>
      ) : null}
    </>
  );
  const className = `flex min-h-[88px] items-center gap-4 rounded-3xl p-4 md:gap-3 lg:min-h-[104px] lg:gap-4 lg:p-5 ${tint.card}`;
  return group.on_sale ? (
    <Link href={`/account/catalog?group=${encodeURIComponent(group.key)}`} className={`${className} transition hover:-translate-y-0.5 hover:shadow-md`}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

/** A product as a compact row: logo art, name, what it is, price, chevron. */
export function ProductLine({ product }: { product: StoreProduct }) {
  return (
    <Link href={productHref(product, appProductBase)} className="flex items-center gap-3 rounded-2xl bg-white p-2.5 shadow-sm ring-1 ring-slate-200/70 transition hover:shadow-md">
      {/* The brand's logo on a white tile over its colour (the card art is padded for big cards, too much at this size). */}
      <span className="grid h-[52px] w-20 shrink-0 place-items-center rounded-xl" style={{ backgroundColor: product.brand.color ?? "#070f4c" }}>
        <span className="grid size-10 place-items-center overflow-hidden rounded-lg bg-white p-1.5 shadow-sm">
          {product.brand.logo_url ? (
            <BrandImage src={product.brand.logo_url} className="size-7 object-contain" fallback={<span className="text-xs font-extrabold text-[#070f4c]">{product.brand.initials}</span>} />
          ) : (
            <span className="text-xs font-extrabold text-[#070f4c]">{product.brand.initials}</span>
          )}
        </span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-bold text-[#070f4c]">{product.name}</span>
        <span className="block truncate text-sm text-slate-500">{product.global ? product.category_label : `${product.category_label} · ${product.country_name}`}</span>
        <span className="block text-sm font-extrabold text-[#070f4c]">{priceLabel(product)}</span>
      </span>
      <ChevronRight className="size-5 shrink-0 text-slate-400" aria-hidden="true" />
    </Link>
  );
}

/** A section heading with an optional "See all" link. */
export function SectionTitle({ id, title, href, action = "See all" }: { id: string; title: string; href?: string; action?: string }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <h2 id={id} className="text-xl font-extrabold tracking-tight text-[#070f4c]">
        {title}
      </h2>
      {href ? (
        <Link href={href} className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-[#ff2382] hover:underline">
          {action} <ChevronRight className="size-4" aria-hidden="true" />
        </Link>
      ) : null}
    </div>
  );
}

/**
 * A horizontal row of cards that scrolls sideways on its own (snap, no script), so long lists never crowd the page or
 * make it scroll sideways. It bleeds to the screen edge on phones.
 */
export function Carousel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <ul aria-label={label} className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:thin] sm:-mx-6 sm:scroll-px-6 sm:px-6 lg:mx-0 lg:scroll-px-0 lg:px-0">
      {children}
    </ul>
  );
}

export function CarouselItem({ children, width = "w-[68%] sm:w-64" }: { children: React.ReactNode; width?: string }) {
  return <li className={`shrink-0 snap-start ${width}`}>{children}</li>;
}
