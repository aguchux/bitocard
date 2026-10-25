import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { listingPath, nameInitials, shopPriceText, type ShopChat } from "@bitocard/api-client/classifieds";
import { ChatThread } from "@/components/app/shop/chat-thread";
import { Thumb } from "@/components/app/shop/thumb";
import { customerApi } from "@/lib/customer";
import { uuidPattern } from "@/lib/shop";
import { requireShop, shopHref, shopOrigin } from "@/lib/shop-server";

export const metadata: Metadata = { title: "Chat" };

type Props = { params: Promise<{ id: string }> };

/** A chat about a listing: who with, the listing (its public page for the buyer, the seller's own ad for the seller), then the thread. */
export default async function ChatPage({ params }: Props) {
  const { id } = await params;
  await requireShop(`/shop/messages/${id}`);
  if (!uuidPattern.test(id)) notFound();
  const result = await customerApi<ShopChat>("GET", `/v1/classifieds/conversations/${id}`);
  if (!result.ok) notFound();
  const chat = result.data;
  const { listing } = chat;
  const live = listing.status === "active" && listing.slug;
  const listingHref = chat.role === "seller" ? `/shop/listings/${listing.id}` : live ? shopHref(listingPath(listing.country, listing.ref, listing.slug!)) : null;
  const buy = chat.role === "buyer" && live ? { handoff: shopHref(""), path: `/${listing.country.toLowerCase()}/l/${listing.ref}/buy` } : null;
  const card = (
    <>
      <Thumb url={listing.cover_url} size="size-12" />
      <span className="grid min-w-0 flex-1">
        <span className="truncate text-sm font-semibold">{listing.title ?? "A listing"}</span>
        <span className="text-sm font-bold">{shopPriceText(listing.price)}</span>
      </span>
      {listing.status !== "active" ? <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-700">{listing.status === "sold" ? "Sold" : "Not live"}</span> : null}
    </>
  );
  return (
    <div className="grid max-w-3xl gap-3">
      <header className="flex items-center gap-2">
        <Link href="/shop/messages" aria-label="Back to messages" className="-ml-2 grid size-10 place-items-center rounded-full hover:bg-slate-100">
          <ChevronLeft className="size-6" aria-hidden="true" />
        </Link>
        <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-full bg-navy-900 text-[13px] font-bold text-white">
          {nameInitials(chat.with.name)}
        </span>
        <h1 className="min-w-0 flex-1 truncate text-lg font-extrabold">{chat.with.name}</h1>
      </header>
      {listingHref ? (
        chat.role === "seller" ? (
          <Link href={listingHref} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-2.5 hover:border-slate-300">
            {card}
          </Link>
        ) : (
          <a href={listingHref} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-2.5 hover:border-slate-300">
            {card}
          </a>
        )
      ) : (
        <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-2.5">{card}</div>
      )}
      <p className="rounded-xl bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
        Keep the chat here. Meet in a busy place, inspect before paying, never pay in advance. BitoCard never asks for codes.{" "}
        <a href={`${shopOrigin()}/safe-trade`} className="font-semibold underline">
          Safe Trade Guide
        </a>
      </p>
      <ChatThread initial={chat} buy={buy} />
    </div>
  );
}
