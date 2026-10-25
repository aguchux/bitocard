import type { Metadata } from "next";
import Link from "next/link";
import { nameInitials, postedAgo, shopPriceText, type ShopConversations } from "@bitocard/api-client/classifieds";
import { ShopPills, ShopTitle } from "@/components/app/shop/shop-nav";
import { Thumb } from "@/components/app/shop/thumb";
import { customerApi } from "@/lib/customer";
import { requireShop } from "@/lib/shop-server";

export const metadata: Metadata = { title: "Messages" };

type Props = { searchParams: Promise<{ role?: string }> };

const roles = [
  { role: null, label: "All" },
  { role: "buying", label: "Buying" },
  { role: "selling", label: "Selling" },
] as const;

/** Every chat about a listing, buying and selling, most recent first; a chat started on a listing page carries on here. */
export default async function Messages({ searchParams }: Props) {
  const { role: asked } = await searchParams;
  const { shop } = await requireShop("/shop/messages");
  const role = roles.find(item => item.role === asked) ?? roles[0];
  const result = await customerApi<ShopConversations>("GET", `/v1/classifieds/conversations?limit=50${role.role ? `&role=${role.role}` : ""}`);
  const chats = result.ok ? result.data.data : [];
  return (
    <div className="grid gap-5">
      <ShopTitle title="Messages" />
      <ShopPills shop={shop} active="/shop/messages" />
      <nav aria-label="Chats by role">
        <ul className="flex gap-2">
          {roles.map(item => (
            <li key={item.label}>
              <Link
                href={item.role ? `/shop/messages?role=${item.role}` : "/shop/messages"}
                aria-current={item === role ? "page" : undefined}
                className={`flex h-9 items-center rounded-full border px-4 text-[13px] font-semibold ${item === role ? "border-navy-900 bg-navy-900 text-white" : "border-slate-300 bg-white text-navy-900"}`}
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {!result.ok ? (
        <p className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-600">Your messages could not be loaded just now. Try again shortly.</p>
      ) : chats.length ? (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
          {chats.map(chat => (
            <li key={chat.id}>
              <Link href={`/shop/messages/${chat.id}`} className={`flex gap-3 px-3 py-3 hover:bg-slate-50 ${chat.unread ? "bg-brand-50/40" : ""}`}>
                <span className="relative">
                  <Thumb url={chat.listing.cover_url} size="size-14" />
                  <span aria-hidden="true" className="absolute -right-1 -bottom-1 grid size-6 place-items-center rounded-full bg-navy-900 text-[10px] font-bold text-white ring-2 ring-white">
                    {nameInitials(chat.with.name)}
                  </span>
                </span>
                <span className="grid min-w-0 flex-1 gap-0.5">
                  <span className="flex items-baseline justify-between gap-2">
                    <strong className="truncate text-sm">{chat.with.name}</strong>
                    <span className="shrink-0 text-xs text-slate-500">{postedAgo(chat.last_message_at)}</span>
                  </span>
                  <span className="truncate text-xs text-slate-600">
                    {chat.role === "seller" ? "You sell: " : ""}
                    {chat.listing.title ?? "A listing"} · {shopPriceText(chat.listing.price)}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className={`min-w-0 flex-1 truncate text-sm ${chat.unread ? "font-semibold text-navy-900" : "text-slate-600"}`}>
                      {chat.last_message ? `${chat.last_message.from === "me" ? "You: " : ""}${chat.last_message.kind === "photo" ? "Sent a photo" : chat.last_message.body}` : "No messages yet"}
                    </span>
                    {chat.unread ? (
                      <span className="grid h-5 min-w-5 place-items-center rounded-full bg-brand-700 px-1.5 text-[11px] font-bold text-white">
                        {chat.unread}
                        <span className="sr-only"> unread</span>
                      </span>
                    ) : null}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-600">
          {role.role === "selling" ? "When buyers write about your listings, their chats show here." : "Chats with sellers show here. Find something on BitoCard Shop and write to the seller."}
        </p>
      )}
    </div>
  );
}
