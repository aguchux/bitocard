import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ShopConversations, ShopCourier, ShopDispute, ShopOrder, ShopReadiness, ShopWallet } from "@bitocard/api-client/classifieds";
import { OrderDetail } from "@/components/app/shop/order-detail";
import { customerApi } from "@/lib/customer";
import { orderActions, uuidPattern } from "@/lib/shop";
import { requireShop } from "@/lib/shop-server";

export const metadata: Metadata = { title: "Safe pay order" };

type Props = { params: Promise<{ id: string }> };

/**
 * A Safe pay order in the Shop tab, from the reader's side: BitoCard Shop's own orders, and resale orders from
 * resellers' stores, which the supplier accepts, hands over or ships here.
 */
export default async function ShopOrderPage({ params }: Props) {
  const { id } = await params;
  await requireShop(`/shop/orders/${id}`);
  if (!uuidPattern.test(id)) notFound();
  const result = await customerApi<ShopOrder>("GET", `/v1/classifieds/orders/${id}`);
  if (!result.ok) notFound();
  const order = result.data;
  const buyer = order.role === "buyer";
  const actions = orderActions(order);
  const [readiness, wallet, dispute, chats, couriers] = await Promise.all([
    actions.includes("accept") ? customerApi<ShopReadiness>("GET", "/v1/classifieds/me/safe-pay") : null,
    actions.includes("pay") ? customerApi<ShopWallet>("GET", `/v1/store/wallet?currency=${encodeURIComponent(order.currency)}`) : null,
    order.dispute ? customerApi<ShopDispute>("GET", `/v1/classifieds/orders/${id}/dispute`) : null,
    order.kind === "direct" ? customerApi<ShopConversations>("GET", `/v1/classifieds/conversations?role=${buyer ? "buying" : "selling"}&limit=50`) : null,
    actions.includes("sent") ? customerApi<{ data: ShopCourier[] }>("GET", "/v1/classifieds/safe-pay/couriers") : null,
  ]);
  // The chat between the two about this listing, when they have one (a buyer has one per listing; a seller's is the one
  // with this buyer's name, linked only when no other buyer of the listing shares it). Resale orders have their own threads.
  const matches = chats?.ok ? chats.data.data.filter(item => item.listing.id === order.listing.id && item.with.name === order.with.name) : [];
  const chatHref = matches.length === 1 ? `/shop/messages/${matches[0]!.id}` : null;
  return (
    <OrderDetail
      order={order}
      actions={actions}
      readiness={readiness?.ok ? readiness.data : null}
      balance={wallet?.ok ? wallet.data.balance : null}
      addFundsHref={`/account/wallet${order.currency === "USD" ? "?wallet=USD" : ""}`}
      chatHref={chatHref}
      couriers={couriers?.ok ? couriers.data.data : []}
      dispute={dispute?.ok ? dispute.data : null}
      back={{ href: `/shop/orders${buyer ? "" : "?role=selling"}`, label: "Back to orders" }}
    />
  );
}
