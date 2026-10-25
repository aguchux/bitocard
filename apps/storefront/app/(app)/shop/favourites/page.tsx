/* eslint-disable @next/next/no-img-element -- listing covers from the media CDN. */
import type { Metadata } from "next";
import { ImageIcon } from "lucide-react";
import { listingPath, shopMoney, shopPriceText, type ShopFavourites } from "@bitocard/api-client/classifieds";
import { RemoveFavourite } from "@/components/app/shop/remove-favourite";
import { ShopPills, ShopTitle } from "@/components/app/shop/shop-nav";
import { customerApi } from "@/lib/customer";
import { requireShop, shopHref } from "@/lib/shop-server";

export const metadata: Metadata = { title: "Favourites" };

/** Saved listings, newest saved first, marked when the price dropped since saving or the item sold. */
export default async function Favourites() {
  const { shop } = await requireShop("/shop/favourites");
  const result = await customerApi<ShopFavourites>("GET", "/v1/classifieds/favourites?limit=100");
  const items = result.ok ? result.data.data : [];
  return (
    <div className="grid gap-5">
      <ShopTitle title="Favourites" note="We tell you when a price drops or an item sells." post={false} />
      <ShopPills shop={shop} active="/shop/favourites" />
      {!result.ok ? (
        <p className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-600">Your favourites could not be loaded just now. Try again shortly.</p>
      ) : items.length ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {items.map(item => {
            const card = item.listing;
            const title = card?.title ?? "No longer listed";
            const badge = item.state === "sold" ? { text: "Sold", tone: "bg-navy-900 text-white" } : item.price_drop && card ? { text: `${shopMoney(item.price_drop, card.price.currency)} cheaper`, tone: "bg-emerald-50 text-emerald-900" } : null;
            const inner = (
              <>
                <span className="relative block aspect-[4/3] overflow-hidden rounded-xl bg-slate-100">
                  {card?.cover ? <img src={card.cover.url} alt="" className="size-full object-cover" loading="lazy" /> : <ImageIcon className="absolute inset-0 m-auto size-6 text-slate-400" aria-hidden="true" />}
                  {badge ? <span className={`absolute bottom-2 left-2 rounded-full px-2 py-0.5 text-[11px] font-bold ${badge.tone}`}>{badge.text}</span> : null}
                </span>
                <span className="grid gap-0.5 px-1 pt-2">
                  <strong className="text-sm">{card ? shopPriceText(card.price) : ""}</strong>
                  <span className="truncate text-sm">{title}</span>
                  <span className="truncate text-xs text-slate-500">{card ? card.area.name : "Removed by the seller or BitoCard"}</span>
                </span>
              </>
            );
            return (
              <li key={item.listing_id} className={`relative ${item.state === "live" ? "" : "opacity-70"}`}>
                {card && item.state !== "gone" ? (
                  <a href={shopHref(listingPath(card.country, card.ref, card.slug))} className="block">
                    {inner}
                  </a>
                ) : (
                  <div>{inner}</div>
                )}
                <RemoveFavourite listingId={item.listing_id} title={title} />
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-600">Tap the heart on a listing on BitoCard Shop to save it here.</p>
      )}
    </div>
  );
}
